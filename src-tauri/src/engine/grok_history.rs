//! Read Grok CLI session history from
//! `<grok-home>/sessions/<url-encoded-cwd>/<sessionId>/{summary.json,chat_history.jsonl}`.
//!
//! Layout (grok 0.2.111):
//! - `sessions/<url-encoded-cwd>/`: one directory per working directory; the dir
//!   name is the session cwd URL-encoded (`/private/tmp` → `%2Fprivate%2Ftmp`).
//!   On macOS the CLI canonicalizes cwd (`/tmp` → `/private/tmp`), so workspace
//!   matching canonicalizes both sides and tolerates symlink variants.
//! - `summary.json`: `{info:{id,cwd}, session_summary, created_at, updated_at,
//!   num_messages, num_chat_messages, generated_title, ...}` (RFC3339 times;
//!   fields may evolve — parsed defensively).
//! - `chat_history.jsonl`: one JSON object per line. Relevant line types:
//!   - `user` — prompt (`content: [{type:"text", text:"<user_query>…</user_query>"}]`);
//!     lines carrying `synthetic_reason` are synthetic reminders and skipped.
//!     Runtime context envelopes Grok injects without `synthetic_reason`
//!     (`<user_info>`, `<rules>`, `<git_status>`, bare `<system-reminder>`, …)
//!     are also skipped so they do not appear as user bubbles or drive sidebar
//!     titles. Bootstrap lines often concatenate several envelopes without a
//!     `<user_query>`; those whole lines are treated as context even when
//!     residual markup remains after stripping a short known-tag list.
//!   - `reasoning` — `{id, summary}` (summary string or parts array)
//!   - `assistant` — `{content, tool_calls:[{id, function:{name, arguments}}]}`
//!   - `tool_result` — `{tool_call_id, content}`
//!   Other types (`system`, unknown) are skipped. Lines carry no usage data.
//! - Sidebar `first_message` prefers the first real user prompt text; Grok's
//!   `generated_title` / `session_summary` is only a fallback.
//! - Sidebar `updated_at` prefers `chat_history.jsonl` mtime over
//!   `summary.json`'s `updated_at`. Grok CLI may bulk-rewrite summary metadata
//!   (including `updated_at`) without new conversation activity; trusting the
//!   summary stamp alone makes every row look like "刚刚".
//!
//! Performance (list / load):
//! - Sidebar list streams `chat_history.jsonl` with `BufReader` and stops at the
//!   first real user prompt (or uses `summary.json` title fallback). It never
//!   loads whole multi-MB histories just for a row title.
//! - Session load streams line-by-line, redacts large string fields
//!   (`encrypted_content`, image `url` / `data`, oversized `text`/`content`),
//!   and applies tool-output budgets before returning to the UI.
//! - Session lookup prefers O(1) `sessions/<urlencode(cwd-variant)>/<id>/`
//!   candidates, falling back to a workspace-filtered directory scan only when
//!   the direct path is missing.

use chrono::DateTime;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::borrow::Cow;
use std::io::{BufRead, BufReader as StdBufReader};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::fs;
use tokio::io::{AsyncBufReadExt, BufReader as AsyncBufReader};
use tokio::time::timeout;

const LOCAL_SESSION_SCAN_TIMEOUT: Duration = Duration::from_secs(60);

/// Lines at or below this size are parsed as-is (still may strip heavy keys).
const GROK_LARGE_LINE_BYTE_BUDGET: usize = 512 * 1024;
/// Max bytes kept for individual heavy JSON string fields before parse.
const GROK_STRING_FIELD_BYTE_BUDGET: usize = 16 * 1024;
/// Soft budget for free-form text/content fields on large lines.
const GROK_TEXT_FIELD_BYTE_BUDGET: usize = 64 * 1024;
/// Tool result / tool input text returned to the renderer.
const GROK_TOOL_OUTPUT_CHAR_BUDGET: usize = 48 * 1024;
const GROK_TOOL_INPUT_JSON_BYTE_BUDGET: usize = 32 * 1024;
const GROK_OMITTED_PAYLOAD_SENTINEL: &str = "__ccgui_omitted_large_grok_payload__";

fn normalize_session_id(session_id: &str) -> Result<String, String> {
    let normalized = session_id.trim();
    if normalized.is_empty()
        || normalized == "."
        || normalized.contains('/')
        || normalized.contains('\\')
        || normalized.contains("..")
    {
        return Err("[SESSION_NOT_FOUND] Invalid Grok session id".to_string());
    }
    Ok(normalized.to_string())
}

/// Summary of a Grok session for sidebar display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokSessionSummary {
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
    /// 子代理会话的父 session id（裸 id，无 `grok:` 前缀）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    /// `subagent` | 其它（主会话）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_kind: Option<String>,
}

/// Single normalized message row used by frontend history parser.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokSessionMessage {
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
pub struct GrokSessionUsage {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_creation_input_tokens: Option<i64>,
    pub cache_read_input_tokens: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokSessionLoadResult {
    pub messages: Vec<GrokSessionMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<GrokSessionUsage>,
}

fn parse_timestamp_millis(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

fn file_mtime_millis(path: &Path) -> Option<i64> {
    std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
}

/// Resolve the activity timestamp shown in the sidebar.
///
/// Prefer the conversation file mtime (`chat_history.jsonl`) over
/// `summary.json`'s `updated_at`. Grok CLI has been observed bulk-rewriting
/// summary metadata for many sessions at once without appending chat lines;
/// using those stamps makes every visible row collapse to "刚刚".
fn resolve_session_activity_millis(
    chat_history_mtime_millis: Option<i64>,
    summary_updated_at_millis: Option<i64>,
    summary_mtime_millis: Option<i64>,
    created_at_millis: i64,
) -> i64 {
    chat_history_mtime_millis
        .or(summary_updated_at_millis)
        .or(summary_mtime_millis)
        .unwrap_or(created_at_millis)
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let truncated: String = value.chars().take(max_chars).collect();
    format!("{}…", truncated)
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
        variants.push(format!("/private{}", normalized));
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

fn path_is_same_or_child(candidate: &str, base: &str) -> bool {
    if candidate.is_empty() || base.is_empty() {
        return false;
    }
    if candidate == base {
        return true;
    }
    if base == "/" {
        return candidate.starts_with('/');
    }
    candidate.starts_with(base) && candidate.chars().nth(base.len()) == Some('/')
}

fn matches_workspace_path(work_dir: &str, workspace_variants: &[String]) -> bool {
    if workspace_variants.is_empty() {
        return false;
    }
    let mut work_dir_variants = build_path_variants(work_dir);
    // grok canonicalizes the session cwd (e.g. macOS `/tmp` → `/private/tmp`);
    // match canonical forms on both sides to tolerate symlink variants.
    if let Ok(canonical_work_dir) = std::fs::canonicalize(work_dir) {
        work_dir_variants.extend(build_path_variants(&canonical_work_dir.to_string_lossy()));
        work_dir_variants.sort();
        work_dir_variants.dedup();
    }
    for candidate in work_dir_variants {
        for workspace in workspace_variants {
            // One-way only: session cwd must be the workspace or a child of it.
            // Reverse matching leaks home-directory Grok history into every nested
            // empty folder under $HOME (observed: 17 sessions under /Users/me).
            if path_is_same_or_child(&candidate, workspace) {
                return true;
            }
        }
    }
    false
}

fn expand_home_prefixed_path(path: &str) -> Option<PathBuf> {
    if path == "~" {
        return dirs::home_dir();
    }
    let relative = path
        .strip_prefix("~/")
        .or_else(|| path.strip_prefix("~\\"))
        .filter(|value| !value.is_empty())?;
    dirs::home_dir().map(|home| home.join(relative))
}

pub(crate) fn resolve_grok_base_dir(custom_home: Option<&str>) -> PathBuf {
    if let Some(home) = custom_home.map(str::trim).filter(|value| !value.is_empty()) {
        if let Some(expanded) = expand_home_prefixed_path(home) {
            return expanded;
        }
        return PathBuf::from(home);
    }
    if let Some(home) = std::env::var_os("GROK_HOME").filter(|value| !value.is_empty()) {
        let configured = PathBuf::from(home);
        let configured_text = configured.to_string_lossy();
        if let Some(expanded) = expand_home_prefixed_path(&configured_text) {
            return expanded;
        }
        return configured;
    }
    dirs::home_dir().unwrap_or_default().join(".grok")
}

/// Percent-decode a `sessions/<dir>` name back into its cwd
/// (`%2Fprivate%2Ftmp` → `/private/tmp`). Invalid escapes pass through verbatim.
fn url_decode_dir_name(encoded: &str) -> String {
    let bytes = encoded.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
            if let Ok(value) = u8::from_str_radix(hex, 16) {
                decoded.push(value);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).to_string()
}

/// Percent-encode a cwd path the way Grok CLI names `sessions/<dir>`
/// (UTF-8 bytes; unreserved characters stay literal; others → `%XX`).
fn url_encode_dir_name(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len().saturating_mul(3));
    for &byte in path.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                use std::fmt::Write as _;
                let _ = write!(encoded, "%{:02X}", byte);
            }
        }
    }
    encoded
}

pub(crate) fn candidate_encoded_cwd_names(workspace_path: &Path) -> Vec<String> {
    let mut names: Vec<String> = build_workspace_path_variants(workspace_path)
        .into_iter()
        .map(|variant| url_encode_dir_name(&variant))
        .collect();
    names.sort();
    names.dedup();
    names
}

pub(crate) fn session_dir_looks_valid(session_dir: &Path) -> bool {
    session_dir.is_dir()
        && (session_dir.join("chat_history.jsonl").is_file()
            || session_dir.join("summary.json").is_file())
}

fn find_json_string_end(input: &str, value_start: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    let mut cursor = value_start;
    let mut escaped = false;
    while cursor < bytes.len() {
        let byte = bytes[cursor];
        if escaped {
            escaped = false;
        } else if byte == b'\\' {
            escaped = true;
        } else if byte == b'"' {
            return Some(cursor);
        }
        cursor += 1;
    }
    None
}

/// Redact oversized JSON string values for a target key before `serde_json` parse.
/// Mirrors Claude history large-payload handling so multi-MB image / encrypted
/// blobs never enter the Value tree.
fn redact_json_string_field_values(
    input: &str,
    target_key: &str,
    value_byte_budget: usize,
    replacement: &str,
) -> String {
    let mut output = String::with_capacity(input.len().min(GROK_LARGE_LINE_BYTE_BUDGET));
    let mut index = 0;
    let key_pattern = format!("\"{}\"", target_key);

    while let Some(relative_key_start) = input[index..].find(&key_pattern) {
        let key_start = index + relative_key_start;
        output.push_str(&input[index..key_start + key_pattern.len()]);
        let mut cursor = key_start + key_pattern.len();

        while let Some(byte) = input.as_bytes().get(cursor) {
            if byte.is_ascii_whitespace() {
                output.push(*byte as char);
                cursor += 1;
                continue;
            }
            break;
        }

        if input.as_bytes().get(cursor) != Some(&b':') {
            index = cursor;
            continue;
        }
        output.push(':');
        cursor += 1;

        while let Some(byte) = input.as_bytes().get(cursor) {
            if byte.is_ascii_whitespace() {
                output.push(*byte as char);
                cursor += 1;
                continue;
            }
            break;
        }

        if input.as_bytes().get(cursor) != Some(&b'"') {
            index = cursor;
            continue;
        }

        let value_start = cursor + 1;
        let Some(value_end) = find_json_string_end(input, value_start) else {
            index = cursor;
            continue;
        };
        let value = &input[value_start..value_end];
        if value.len() > value_byte_budget {
            output.push('"');
            output.push_str(replacement);
            output.push('"');
        } else {
            output.push_str(&input[cursor..=value_end]);
        }
        index = value_end + 1;
    }

    output.push_str(&input[index..]);
    output
}

fn blank_json_array_field(input: &str, target_key: &str) -> String {
    let key_pattern = format!("\"{}\"", target_key);
    let Some(key_start) = input.find(&key_pattern) else {
        return input.to_string();
    };
    let mut cursor = key_start + key_pattern.len();
    let bytes = input.as_bytes();
    while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    if bytes.get(cursor) != Some(&b':') {
        return input.to_string();
    }
    cursor += 1;
    while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    if bytes.get(cursor) != Some(&b'[') {
        return input.to_string();
    }
    let array_start = cursor;
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    while cursor < bytes.len() {
        let byte = bytes[cursor];
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
        } else {
            match byte {
                b'"' => in_string = true,
                b'[' => depth += 1,
                b']' => {
                    depth -= 1;
                    if depth == 0 {
                        let mut out =
                            String::with_capacity(input.len().saturating_sub(cursor - array_start));
                        out.push_str(&input[..array_start]);
                        out.push_str("[]");
                        out.push_str(&input[cursor + 1..]);
                        return out;
                    }
                }
                _ => {}
            }
        }
        cursor += 1;
    }
    input.to_string()
}

/// Prepare a JSONL line for parse: strip / budget heavy payloads the UI never needs.
fn prepare_grok_history_line_for_parse(line: &str) -> Cow<'_, str> {
    let has_heavy_keys = line.contains("encrypted_content")
        || line.contains("\"images\"")
        || line.contains("data:image")
        || line.len() > GROK_LARGE_LINE_BYTE_BUDGET;
    if !has_heavy_keys {
        return Cow::Borrowed(line);
    }

    let mut prepared = line.to_string();
    if prepared.contains("\"images\"") {
        prepared = blank_json_array_field(&prepared, "images");
    }
    prepared = redact_json_string_field_values(
        &prepared,
        "encrypted_content",
        GROK_STRING_FIELD_BYTE_BUDGET,
        GROK_OMITTED_PAYLOAD_SENTINEL,
    );
    prepared = redact_json_string_field_values(
        &prepared,
        "url",
        GROK_STRING_FIELD_BYTE_BUDGET,
        GROK_OMITTED_PAYLOAD_SENTINEL,
    );
    prepared = redact_json_string_field_values(
        &prepared,
        "data",
        GROK_STRING_FIELD_BYTE_BUDGET,
        GROK_OMITTED_PAYLOAD_SENTINEL,
    );
    if prepared.len() > GROK_LARGE_LINE_BYTE_BUDGET || prepared.contains("data:image") {
        prepared = redact_json_string_field_values(
            &prepared,
            "text",
            GROK_TEXT_FIELD_BYTE_BUDGET,
            GROK_OMITTED_PAYLOAD_SENTINEL,
        );
        prepared = redact_json_string_field_values(
            &prepared,
            "content",
            GROK_TEXT_FIELD_BYTE_BUDGET,
            GROK_OMITTED_PAYLOAD_SENTINEL,
        );
        prepared = redact_json_string_field_values(
            &prepared,
            "arguments",
            GROK_TOOL_INPUT_JSON_BYTE_BUDGET,
            GROK_OMITTED_PAYLOAD_SENTINEL,
        );
    }
    Cow::Owned(prepared)
}

fn strip_embedded_data_urls(text: &str) -> String {
    if !text.contains("data:image") {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len().min(GROK_TEXT_FIELD_BYTE_BUDGET));
    let bytes = text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if let Some(rel) = text[index..].find("data:image") {
            let start = index + rel;
            out.push_str(&text[index..start]);
            out.push_str("[omitted-inline-image]");
            // Skip until whitespace, quote, or end.
            let mut cursor = start + "data:image".len();
            while cursor < bytes.len() {
                let b = bytes[cursor];
                if b.is_ascii_whitespace() || b == b'"' || b == b'\'' || b == b')' || b == b']' {
                    break;
                }
                cursor += 1;
            }
            index = cursor;
        } else {
            out.push_str(&text[index..]);
            break;
        }
    }
    out
}

fn budget_tool_text(text: &str) -> String {
    if text.chars().count() <= GROK_TOOL_OUTPUT_CHAR_BUDGET {
        return text.to_string();
    }
    let truncated: String = text.chars().take(GROK_TOOL_OUTPUT_CHAR_BUDGET).collect();
    format!(
        "{}\n\n…[truncated {} chars for history load]",
        truncated,
        text.chars()
            .count()
            .saturating_sub(GROK_TOOL_OUTPUT_CHAR_BUDGET)
    )
}

fn budget_tool_input_value(value: Option<Value>) -> Option<Value> {
    let Some(value) = value else {
        return None;
    };
    match serde_json::to_string(&value) {
        Ok(raw) if raw.len() <= GROK_TOOL_INPUT_JSON_BYTE_BUDGET => Some(value),
        Ok(raw) => {
            let truncated: String = raw.chars().take(GROK_TOOL_INPUT_JSON_BYTE_BUDGET).collect();
            Some(Value::String(format!(
                "{}…[truncated tool input]",
                truncated
            )))
        }
        Err(_) => Some(Value::String(GROK_OMITTED_PAYLOAD_SENTINEL.to_string())),
    }
}

/// Unescape a fragment taken from inside a JSON string (raw JSONL bytes).
fn unescape_json_string_fragment(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('"') => out.push('"'),
            Some('\\') => out.push('\\'),
            Some('/') => out.push('/'),
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                if hex.len() == 4 {
                    if let Ok(code) = u16::from_str_radix(&hex, 16) {
                        if let Some(decoded) = char::from_u32(u32::from(code)) {
                            out.push(decoded);
                            continue;
                        }
                    }
                }
                out.push_str("\\u");
                out.push_str(&hex);
            }
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

fn extract_user_query_body_from_raw(line: &str) -> Option<String> {
    let start = line.rfind("<user_query>")? + "<user_query>".len();
    let rest = &line[start..];
    let end = rest.find("</user_query>")?;
    // Body is still JSON-escaped when taken from the raw line.
    let body = unescape_json_string_fragment(&rest[..end]);
    let body = body.trim();
    if body.is_empty() {
        None
    } else {
        Some(body.to_string())
    }
}

fn extract_timestamp_text(value: &Value) -> Option<String> {
    if let Some(millis) = value.get("time").and_then(|v| v.as_i64()) {
        return DateTime::from_timestamp_millis(millis).map(|dt| dt.to_rfc3339());
    }
    for key in ["timestamp", "created_at", "createdAt"] {
        if let Some(text) = value.get(key).and_then(|v| v.as_str()) {
            if DateTime::parse_from_rfc3339(text).is_ok() {
                return Some(text.to_string());
            }
        }
    }
    None
}

/// Content may be a plain string or a `[{type:"text",text}]` parts array.
fn extract_content_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter(|part| part.get("type").and_then(|v| v.as_str()) == Some("text"))
            .filter_map(|part| part.get("text").and_then(|v| v.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Reasoning `summary` is normally a string; tolerate string arrays / parts.
fn extract_reasoning_summary(summary: Option<&Value>) -> String {
    match summary {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .map(|part| {
                part.as_str()
                    .map(|value| value.to_string())
                    .or_else(|| {
                        part.get("text")
                            .and_then(|v| v.as_str())
                            .map(|value| value.to_string())
                    })
                    .unwrap_or_default()
            })
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn strip_user_query_wrapper(text: &str) -> String {
    let trimmed = text.trim();
    // Prefer extracting the last <user_query>…</user_query> body when present
    // (Grok multimodal history prefixes an <image_files> block).
    if let Some(start) = trimmed.rfind("<user_query>") {
        let after = &trimmed[start + "<user_query>".len()..];
        if let Some(end) = after.find("</user_query>") {
            return after[..end].trim().to_string();
        }
    }
    let inner = trimmed
        .strip_prefix("<user_query>")
        .and_then(|rest| rest.strip_suffix("</user_query>"))
        .unwrap_or(trimmed);
    inner.trim().to_string()
}

/// Known Grok runtime envelopes that are stored as `type:"user"` but are not
/// human prompts. Grok only marks some of these with `synthetic_reason`.
///
/// `rules` is the large AGENTS.md / workspace-rules pack Grok often appends to
/// the same line as `<user_info>` (still without `synthetic_reason`).
const GROK_RUNTIME_CONTEXT_TAGS: &[&str] = &[
    "user_info",
    "rules",
    "git_status",
    "system-reminder",
    "open_and_recently_viewed_files",
    "agent_skills",
    "mcp_servers",
    "image_compression_notice",
];

fn remove_xml_block_case_insensitive(text: &str, tag: &str) -> String {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let lower = text.to_ascii_lowercase();
    let open_lower = open.to_ascii_lowercase();
    let close_lower = close.to_ascii_lowercase();
    let Some(start) = lower.find(&open_lower) else {
        return text.to_string();
    };
    let after_open = start + open.len();
    let Some(rel_end) = lower[after_open..].find(&close_lower) else {
        // Unclosed envelope: drop from the open tag to end.
        return text[..start].to_string();
    };
    let end = after_open + rel_end + close.len();
    let mut out = String::with_capacity(text.len().saturating_sub(end - start));
    out.push_str(&text[..start]);
    out.push_str(&text[end..]);
    out
}

fn strip_grok_runtime_context_envelopes(text: &str) -> String {
    let mut rest = text.to_string();
    for _ in 0..12 {
        let before = rest.clone();
        for tag in GROK_RUNTIME_CONTEXT_TAGS {
            rest = remove_xml_block_case_insensitive(&rest, tag);
        }
        if rest == before {
            break;
        }
    }
    rest
}

/// True when `text` begins with a known Grok bootstrap open tag (`<user_info>`,
/// `<rules>`, …), optionally with attributes. Case-insensitive.
fn starts_with_grok_runtime_bootstrap_open_tag(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    for tag in GROK_RUNTIME_CONTEXT_TAGS {
        let open = format!("<{tag}");
        if !lower.starts_with(&open) {
            continue;
        }
        let after = &lower[open.len()..];
        // `<tag>` or `<tag attrs…>`
        if after.starts_with('>') || after.starts_with(|c: char| c.is_whitespace()) {
            return true;
        }
    }
    false
}

/// True when a Grok `user` history line is runtime-injected context rather than
/// a real human prompt. Covers envelopes Grok writes without `synthetic_reason`
/// (notably `<user_info>` / `<rules>` / `<git_status>`).
fn is_grok_runtime_context_user_text(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return true;
    }
    // Explicit user prompts (including multimodal) are never treated as context.
    if trimmed.contains("<user_query>") || trimmed.contains("<image_files>") {
        return false;
    }
    // Bootstrap-only lines often start with `<user_info>` then append a large
    // `<rules>` pack (and nested rule markup). Do not require strip-to-empty —
    // residual unknown envelopes would otherwise pollute first_message titles.
    if starts_with_grok_runtime_bootstrap_open_tag(trimmed) {
        return true;
    }
    // After stripping known envelopes, pure context leaves nothing behind.
    // Free-text prompts (legacy / plain) remain and are kept.
    strip_grok_runtime_context_envelopes(trimmed)
        .trim()
        .is_empty()
}

/// Parse Grok wire user text into display text + image absolute paths.
///
/// Multimodal turns are stored as:
/// ```text
/// <image_files>
/// ...
/// 1. /path/to/assets/image-....png
/// ...
/// </image_files>
///
/// <user_query>
/// user text
/// </user_query>
/// ```
///
/// When mossx injects [`super::cli_image_input::GROK_IMAGE_ONLY_FALLBACK_TEXT`]
/// for image-only sends, Grok persists that string as `<user_query>…</user_query>`.
/// The canvas must not show it as user-authored text — strip it here.
pub(crate) fn parse_grok_user_prompt_for_display(text: &str) -> (String, Vec<String>) {
    let images = extract_grok_image_files_paths(text);
    let display = strip_user_query_wrapper(text);
    // If strip left residual image_files markup (no closing user_query), drop it.
    let display = if display.contains("<image_files>") {
        display
            .split("</image_files>")
            .nth(1)
            .unwrap_or("")
            .trim()
            .to_string()
    } else {
        display
    };
    let display = strip_grok_image_only_fallback_text(&display, !images.is_empty());
    (display, images)
}

/// Hide the CLI-only image-only placeholder from user bubbles.
///
/// Only strip when it is the **entire** display text (optionally with trailing
/// punctuation/whitespace). Do not strip when the user typed real content that
/// happens to contain the same phrase.
fn strip_grok_image_only_fallback_text(display: &str, has_images: bool) -> String {
    use super::cli_image_input::GROK_IMAGE_ONLY_FALLBACK_TEXT;
    let trimmed = display.trim();
    if trimmed.is_empty() {
        return display.to_string();
    }
    // Exact match (with or without trailing period variants Grok may normalize).
    let candidates = [
        GROK_IMAGE_ONLY_FALLBACK_TEXT,
        GROK_IMAGE_ONLY_FALLBACK_TEXT.trim_end_matches('.'),
        &format!("{}.", GROK_IMAGE_ONLY_FALLBACK_TEXT.trim_end_matches('.')),
    ];
    let is_fallback = candidates
        .iter()
        .any(|candidate| trimmed.eq_ignore_ascii_case(candidate));
    if is_fallback {
        // Always strip exact fallback — with images this is the image-only path;
        // without images it is still not user-authored (synthetic injection).
        return String::new();
    }
    // Defense: fallback was the only line of a multi-line block that is otherwise empty.
    if has_images {
        let without_fallback = candidates
            .iter()
            .fold(trimmed.to_string(), |acc, candidate| {
                acc.lines()
                    .filter(|line| !line.trim().eq_ignore_ascii_case(candidate))
                    .collect::<Vec<_>>()
                    .join("\n")
                    .trim()
                    .to_string()
            });
        if without_fallback.is_empty() {
            return String::new();
        }
    }
    display.to_string()
}

fn extract_grok_image_files_paths(text: &str) -> Vec<String> {
    let Some(start) = text.find("<image_files>") else {
        return Vec::new();
    };
    let after = &text[start + "<image_files>".len()..];
    let block = after.split("</image_files>").next().unwrap_or(after);
    let mut paths = Vec::new();
    for line in block.lines() {
        let trimmed = line.trim();
        // Numbered list: `1. /abs/path.png`
        let candidate = if let Some((_idx, rest)) = trimmed.split_once(". ") {
            rest.trim()
        } else {
            trimmed
        };
        if candidate.is_empty() {
            continue;
        }
        let looks_absolute = candidate.starts_with('/')
            || candidate.starts_with("%2F")
            || candidate.starts_with("%2f")
            || (candidate.len() >= 3
                && candidate.as_bytes()[0].is_ascii_alphabetic()
                && (candidate.as_bytes()[1] == b':' || candidate.as_bytes()[1] == b'|')
                && (candidate.as_bytes()[2] == b'/' || candidate.as_bytes()[2] == b'\\'))
            || candidate.starts_with("\\\\");
        if !looks_absolute {
            continue;
        }
        let lower = candidate.to_ascii_lowercase();
        let looks_image = lower.contains(".png")
            || lower.contains(".jpg")
            || lower.contains(".jpeg")
            || lower.contains(".gif")
            || lower.contains(".webp")
            || lower.contains(".bmp")
            || lower.contains("/assets/image-")
            || lower.contains("\\assets\\image-")
            || lower.contains("/assets/")
            || lower.contains("\\assets\\");
        if !looks_image {
            continue;
        }
        if !paths.iter().any(|existing: &String| existing == candidate) {
            paths.push(candidate.to_string());
        }
    }
    paths
}

fn stringify_tool_result_content(content: Option<&Value>) -> String {
    let raw = match content {
        Some(Value::String(text)) => strip_embedded_data_urls(text),
        Some(other) => {
            let text = serde_json::to_string(other).unwrap_or_default();
            strip_embedded_data_urls(&text)
        }
        None => String::new(),
    };
    budget_tool_text(&raw)
}

/// Live tool signal extracted from `chat_history.jsonl` (Grok stdout has no tool events).
#[derive(Debug, Clone)]
pub enum GrokHistoryToolSignal {
    Started {
        tool_id: String,
        tool_name: String,
        input: Option<Value>,
    },
    Completed {
        tool_id: String,
        output: Option<Value>,
    },
}

/// Incremental tail state for one live Grok turn.
///
/// On first successful open, `byte_offset` is set to the **current file length** so
/// tools from prior turns (resume) are never re-emitted. Subsequent polls only
/// parse bytes after that offset (line-boundary safe).
#[derive(Debug, Default)]
pub struct GrokToolHistoryTailState {
    /// Whether the baseline (skip-existing) snapshot has been taken.
    pub baseline_set: bool,
    /// When true (resume/continue), first open sets offset to EOF.
    /// When false (brand-new session), first open starts at 0 so first writes are not skipped.
    pub skip_existing_on_baseline: bool,
    /// True if we observed the history file missing at least once this turn
    /// (helps decide create-during-turn vs pre-existing file).
    pub saw_missing: bool,
    /// Byte offset of the next unread byte in `chat_history.jsonl`.
    pub byte_offset: u64,
    /// Incomplete trailing line kept until the next poll completes it.
    pub carry: String,
    pub seen_started: std::collections::HashSet<String>,
    pub seen_completed: std::collections::HashSet<String>,
    pub started_names: std::collections::HashMap<String, String>,
    /// Args from ToolStarted, reattached on Completed for path/diff polish.
    pub started_inputs: std::collections::HashMap<String, Value>,
    synthetic_counter: usize,
}

impl GrokToolHistoryTailState {
    /// `resume_session`: continuing an existing Grok session → skip prior-turn tools.
    pub fn for_turn(resume_session: bool) -> Self {
        Self {
            skip_existing_on_baseline: resume_session,
            ..Self::default()
        }
    }
}

/// Parse tool signals from a JSONL **chunk** (may be partial file tail).
/// Idempotent via `seen_started` / `seen_completed`.
pub fn drain_new_tool_signals_from_chat_history(
    raw: &str,
    seen_started: &mut std::collections::HashSet<String>,
    seen_completed: &mut std::collections::HashSet<String>,
) -> Vec<GrokHistoryToolSignal> {
    let mut counter = 0usize;
    drain_new_tool_signals_from_chat_history_with_counter(
        raw,
        seen_started,
        seen_completed,
        &mut counter,
    )
}

fn drain_new_tool_signals_from_chat_history_with_counter(
    raw: &str,
    seen_started: &mut std::collections::HashSet<String>,
    seen_completed: &mut std::collections::HashSet<String>,
    counter: &mut usize,
) -> Vec<GrokHistoryToolSignal> {
    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let prepared = prepare_grok_history_line_for_parse(line);
        let Ok(value) = serde_json::from_str::<Value>(prepared.as_ref()) else {
            continue;
        };
        let line_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match line_type {
            "assistant" => {
                if let Some(tool_calls) = value.get("tool_calls").and_then(|v| v.as_array()) {
                    for call in tool_calls {
                        let tool_name = resolve_tool_call_name(call);
                        let call_id = call
                            .get("id")
                            .and_then(|v| v.as_str())
                            .map(|value| value.to_string())
                            .unwrap_or_else(|| {
                                *counter += 1;
                                format!("grok-tool-{}", *counter)
                            });
                        if !seen_started.insert(call_id.clone()) {
                            continue;
                        }
                        out.push(GrokHistoryToolSignal::Started {
                            tool_id: call_id,
                            tool_name,
                            input: resolve_tool_call_arguments(call),
                        });
                    }
                }
            }
            "tool_result" => {
                let call_id = value
                    .get("tool_call_id")
                    .and_then(|v| v.as_str())
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| {
                        *counter += 1;
                        format!("grok-tool-{}", *counter)
                    });
                if !seen_completed.insert(call_id.clone()) {
                    continue;
                }
                let output_text = stringify_tool_result_content(value.get("content"));
                let output = if output_text.trim().is_empty() {
                    value.get("content").cloned()
                } else {
                    Some(Value::String(output_text))
                };
                out.push(GrokHistoryToolSignal::Completed {
                    tool_id: call_id,
                    output,
                });
            }
            _ => {}
        }
    }
    out
}

/// Read only new bytes from `path` since `state.byte_offset`, update offset, return new tool signals.
///
/// First call with an existing file sets baseline to EOF (skip prior-turn tools).
pub fn poll_chat_history_tool_signals(
    path: &Path,
    state: &mut GrokToolHistoryTailState,
) -> std::io::Result<Vec<GrokHistoryToolSignal>> {
    use std::io::{Read, Seek, SeekFrom};

    let meta = match std::fs::metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            state.saw_missing = true;
            return Ok(Vec::new());
        }
        Err(error) => return Err(error),
    };
    let file_len = meta.len();

    // Baseline policy:
    // - resume / continue → EOF (do not re-emit prior-turn tools)
    // - new session, or file was missing earlier this turn → start at 0
    //   so the first tool writes of this turn are not skipped
    if !state.baseline_set {
        state.baseline_set = true;
        let skip_existing = state.skip_existing_on_baseline && !state.saw_missing;
        if skip_existing {
            state.byte_offset = file_len;
            state.carry.clear();
            return Ok(Vec::new());
        }
        state.byte_offset = 0;
        state.carry.clear();
        // fall through and read from start
    }

    // Truncation / rewrite: reset to start of file and clear carry (rare).
    if file_len < state.byte_offset {
        state.byte_offset = 0;
        state.carry.clear();
    }

    if file_len == state.byte_offset && state.carry.is_empty() {
        return Ok(Vec::new());
    }

    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(state.byte_offset))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    state.byte_offset += buf.len() as u64;

    let chunk = String::from_utf8_lossy(&buf);
    let combined = if state.carry.is_empty() {
        chunk.into_owned()
    } else {
        let mut s = std::mem::take(&mut state.carry);
        s.push_str(&chunk);
        s
    };

    // Keep incomplete trailing line (no final \n) for next poll.
    let (complete, incomplete) = match combined.rfind('\n') {
        Some(idx) => {
            let complete = combined[..=idx].to_string();
            let incomplete = combined[idx + 1..].to_string();
            (complete, incomplete)
        }
        None => {
            state.carry = combined;
            return Ok(Vec::new());
        }
    };
    state.carry = incomplete;

    Ok(drain_new_tool_signals_from_chat_history_with_counter(
        &complete,
        &mut state.seen_started,
        &mut state.seen_completed,
        &mut state.synthetic_counter,
    ))
}

/// Resolve on-disk `chat_history.jsonl` path for a live session (if present).
pub async fn resolve_chat_history_path(
    workspace_path: &Path,
    session_id: &str,
    custom_home: Option<&str>,
) -> Option<PathBuf> {
    let session_dir = find_workspace_session_dir(workspace_path, session_id, custom_home)
        .await
        .ok()?;
    let path = session_dir.join("chat_history.jsonl");
    // File may appear mid-turn; still return path so poller can wait for create.
    Some(path)
}

/// Resolve tool name from Grok 4.5 flat calls (`name`) or OpenAI-style nested
/// (`function.name`). Only fall back to `"tool"` when both are missing.
fn resolve_tool_call_name(call: &Value) -> String {
    if let Some(name) = call
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        return name.to_string();
    }
    if let Some(name) = call
        .get("function")
        .and_then(|function| function.get("name"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        return name.to_string();
    }
    "tool".to_string()
}

/// Resolve tool arguments from flat `arguments` or nested `function.arguments`.
/// JSON strings are parsed into objects when possible.
fn resolve_tool_call_arguments(call: &Value) -> Option<Value> {
    let arguments = call.get("arguments").or_else(|| {
        call.get("function")
            .and_then(|function| function.get("arguments"))
    })?;
    if let Some(raw) = arguments.as_str() {
        return serde_json::from_str::<Value>(raw)
            .ok()
            .or_else(|| Some(Value::String(raw.to_string())));
    }
    Some(arguments.clone())
}

/// Parse one prepared chat_history JSONL line into zero or more messages.
fn append_messages_from_history_line(
    line: &str,
    messages: &mut Vec<GrokSessionMessage>,
    counter: &mut usize,
) {
    let line = line.trim();
    if line.is_empty() || !line.contains("\"type\"") {
        return;
    }
    let prepared = prepare_grok_history_line_for_parse(line);
    let Ok(value) = serde_json::from_str::<Value>(prepared.as_ref()) else {
        return;
    };
    let line_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let timestamp = extract_timestamp_text(&value);

    match line_type {
        "user" => {
            // Synthetic reminders (`synthetic_reason`) are not user prompts.
            if value.get("synthetic_reason").is_some() {
                return;
            }
            let raw_text = strip_embedded_data_urls(&extract_content_text(value.get("content")));
            // Grok also injects `<user_info>` / `<git_status>` as plain user
            // lines without `synthetic_reason` — hide those from the UI.
            if is_grok_runtime_context_user_text(&raw_text) {
                return;
            }
            let (display_text, image_paths) = parse_grok_user_prompt_for_display(&raw_text);
            if display_text.is_empty() && image_paths.is_empty() {
                return;
            }
            *counter += 1;
            messages.push(GrokSessionMessage {
                id: format!("grok-user-{}", counter),
                role: "user".to_string(),
                text: display_text,
                images: if image_paths.is_empty() {
                    None
                } else {
                    Some(image_paths)
                },
                timestamp,
                kind: "message".to_string(),
                tool_type: None,
                title: None,
                tool_input: None,
                tool_output: None,
            });
        }
        "reasoning" => {
            let text = extract_reasoning_summary(value.get("summary"));
            if text.trim().is_empty() {
                return;
            }
            let part_id = value
                .get("id")
                .and_then(|v| v.as_str())
                .map(|value| value.to_string())
                .unwrap_or_else(|| {
                    *counter += 1;
                    format!("grok-reasoning-{}", *counter)
                });
            messages.push(GrokSessionMessage {
                id: format!("{}-reasoning", part_id),
                role: "assistant".to_string(),
                text,
                images: None,
                timestamp,
                kind: "reasoning".to_string(),
                tool_type: None,
                title: None,
                tool_input: None,
                tool_output: None,
            });
        }
        "assistant" => {
            let text = strip_embedded_data_urls(&extract_content_text(value.get("content")));
            if !text.trim().is_empty() {
                *counter += 1;
                messages.push(GrokSessionMessage {
                    id: format!("grok-assistant-{}", counter),
                    role: "assistant".to_string(),
                    text,
                    images: None,
                    timestamp: timestamp.clone(),
                    kind: "message".to_string(),
                    tool_type: None,
                    title: None,
                    tool_input: None,
                    tool_output: None,
                });
            }
            if let Some(tool_calls) = value.get("tool_calls").and_then(|v| v.as_array()) {
                for call in tool_calls {
                    let tool_name = resolve_tool_call_name(call);
                    let call_id = call
                        .get("id")
                        .and_then(|v| v.as_str())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| {
                            *counter += 1;
                            format!("grok-tool-{}", *counter)
                        });
                    let input_value = budget_tool_input_value(resolve_tool_call_arguments(call));
                    let input_text = input_value
                        .as_ref()
                        .and_then(|v| serde_json::to_string_pretty(v).ok())
                        .map(|text| budget_tool_text(&text))
                        .unwrap_or_default();
                    messages.push(GrokSessionMessage {
                        id: call_id,
                        role: "assistant".to_string(),
                        text: input_text,
                        images: None,
                        timestamp: timestamp.clone(),
                        kind: "tool".to_string(),
                        tool_type: Some(tool_name.clone()),
                        title: Some(tool_name),
                        tool_input: input_value,
                        tool_output: None,
                    });
                }
            }
        }
        "tool_result" => {
            let output_text = stringify_tool_result_content(value.get("content"));
            if output_text.trim().is_empty() {
                return;
            }
            let call_id = value
                .get("tool_call_id")
                .and_then(|v| v.as_str())
                .map(|value| value.to_string())
                .unwrap_or_else(|| {
                    *counter += 1;
                    format!("grok-tool-{}", *counter)
                });
            // Never re-attach raw multi-MB content/images — budgeted text only.
            messages.push(GrokSessionMessage {
                id: format!("{}-result", call_id),
                role: "assistant".to_string(),
                text: output_text.clone(),
                images: None,
                timestamp,
                kind: "tool".to_string(),
                tool_type: Some("result".to_string()),
                title: Some("Result".to_string()),
                tool_input: None,
                tool_output: Some(Value::String(output_text)),
            });
        }
        _ => {}
    }
}

/// Parse `chat_history.jsonl` content into normalized messages.
/// Grok history lines carry no usage data, so `usage` is always `None`.
fn parse_messages_from_chat_history(raw: &str) -> GrokSessionLoadResult {
    let mut messages: Vec<GrokSessionMessage> = Vec::new();
    let mut counter = 0usize;
    for line in raw.lines() {
        append_messages_from_history_line(line, &mut messages, &mut counter);
    }
    GrokSessionLoadResult {
        messages,
        usage: None,
    }
}

fn parse_messages_from_chat_history_reader<R: BufRead>(
    reader: R,
) -> Result<GrokSessionLoadResult, String> {
    let mut messages: Vec<GrokSessionMessage> = Vec::new();
    let mut counter = 0usize;
    for line in reader.lines() {
        let line = line.map_err(|error| format!("Failed to read Grok chat history: {}", error))?;
        append_messages_from_history_line(&line, &mut messages, &mut counter);
    }
    Ok(GrokSessionLoadResult {
        messages,
        usage: None,
    })
}

/// Extract a sidebar preview from one raw JSONL line (cheap path for large lines).
pub(crate) fn first_user_prompt_from_line(line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    // Accept both compact and pretty-ish type markers.
    if !(line.contains("\"type\":\"user\"") || line.contains("\"type\": \"user\"")) {
        return None;
    }
    if line.contains("synthetic_reason") {
        return None;
    }

    // Fast path: pull `<user_query>` without full JSON parse (avoids multi-MB serde).
    if let Some(body) = extract_user_query_body_from_raw(line) {
        let wrapped = format!("<user_query>\n{}\n</user_query>", body);
        if is_grok_runtime_context_user_text(&wrapped) {
            return None;
        }
        let (display_text, image_paths) = parse_grok_user_prompt_for_display(&wrapped);
        let preview = if display_text.is_empty() && !image_paths.is_empty() {
            format!("[{} image(s)]", image_paths.len())
        } else {
            display_text
        };
        if !preview.is_empty() {
            return Some(preview);
        }
    }

    let prepared = prepare_grok_history_line_for_parse(line);
    let Ok(value) = serde_json::from_str::<Value>(prepared.as_ref()) else {
        return None;
    };
    if value.get("type").and_then(|v| v.as_str()) != Some("user") {
        return None;
    }
    if value.get("synthetic_reason").is_some() {
        return None;
    }
    let raw = strip_embedded_data_urls(&extract_content_text(value.get("content")));
    if is_grok_runtime_context_user_text(&raw) {
        return None;
    }
    let (display_text, image_paths) = parse_grok_user_prompt_for_display(&raw);
    let preview = if display_text.is_empty() && !image_paths.is_empty() {
        format!("[{} image(s)]", image_paths.len())
    } else {
        display_text
    };
    if preview.is_empty() {
        None
    } else {
        Some(preview)
    }
}

/// Extract the first real user prompt text from `chat_history.jsonl` content.
fn first_user_prompt_text(raw: &str) -> Option<String> {
    for line in raw.lines() {
        if let Some(preview) = first_user_prompt_from_line(line) {
            return Some(preview);
        }
    }
    None
}

/// Stream `chat_history.jsonl` until the first real user prompt (list path).
async fn first_user_prompt_from_chat_history_path(path: &Path) -> Option<String> {
    let file = fs::File::open(path).await.ok()?;
    let mut lines = AsyncBufReader::new(file).lines();
    loop {
        let line = match lines.next_line().await {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(_) => break,
        };
        if let Some(preview) = first_user_prompt_from_line(&line) {
            return Some(preview);
        }
    }
    None
}

/// 扫描 `*/subagents/{child_id}/meta.json` 建立 child → parent 映射。
async fn build_grok_subagent_parent_map(
    session_dirs: &[(String, PathBuf)],
) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for (parent_id, parent_dir) in session_dirs {
        let subagents_dir = parent_dir.join("subagents");
        let mut entries = match fs::read_dir(&subagents_dir).await {
            Ok(dirs) => dirs,
            Err(_) => continue,
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let child_path = entry.path();
            if !child_path.is_dir() {
                continue;
            }
            let child_id = child_path
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string());
            let Some(child_id) = child_id else {
                continue;
            };
            // meta.json 优先 parent_session_id；否则用父目录 session id
            let parent_from_meta = fs::read_to_string(child_path.join("meta.json"))
                .await
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                .and_then(|value| {
                    value
                        .get("parent_session_id")
                        .or_else(|| value.get("parentSessionId"))
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|v| !v.is_empty())
                        .map(|v| v.to_string())
                });
            map.insert(
                child_id,
                parent_from_meta.unwrap_or_else(|| parent_id.clone()),
            );
        }
    }
    map
}

/// Build a sidebar summary from one session directory. Best-effort: missing
/// or malformed `summary.json` degrades individual fields instead of dropping
/// the session.
async fn build_summary_from_session_dir(
    session_id: &str,
    session_dir: &Path,
    parent_session_id: Option<String>,
) -> GrokSessionSummary {
    let summary_path = session_dir.join("summary.json");
    let chat_history_path = session_dir.join("chat_history.jsonl");

    // List path: summary.json + mtime + stream-to-first-user only.
    // Never full-read multi-MB chat_history.jsonl for sidebar rows.
    let summary_value = fs::read_to_string(&summary_path)
        .await
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());

    let chat_history_mtime_millis = file_mtime_millis(&chat_history_path);
    let summary_mtime_millis = file_mtime_millis(&summary_path);
    let fallback_file_mtime_millis = chat_history_mtime_millis.or(summary_mtime_millis);

    let created_at = summary_value
        .as_ref()
        .and_then(|summary| summary.get("created_at"))
        .and_then(|v| v.as_str())
        .and_then(parse_timestamp_millis)
        .or(fallback_file_mtime_millis)
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
    let summary_updated_at = summary_value
        .as_ref()
        .and_then(|summary| summary.get("updated_at"))
        .and_then(|v| v.as_str())
        .and_then(parse_timestamp_millis);
    let updated_at = resolve_session_activity_millis(
        chat_history_mtime_millis,
        summary_updated_at,
        summary_mtime_millis,
        created_at,
    );

    let title = summary_value
        .as_ref()
        .and_then(|summary| summary.get("session_summary"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .or_else(|| {
            summary_value
                .as_ref()
                .and_then(|summary| summary.get("generated_title"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
        });

    let message_count = summary_value
        .as_ref()
        .and_then(|summary| summary.get("num_chat_messages"))
        .and_then(|v| v.as_u64())
        .or_else(|| {
            summary_value
                .as_ref()
                .and_then(|summary| summary.get("num_messages"))
                .and_then(|v| v.as_u64())
        })
        .map(|value| value as usize)
        .unwrap_or(0);

    // Prefer the human's first real prompt over Grok's AI `generated_title`
    // so the sidebar shows e.g. "你好" instead of "Chinese Hello Greeting Session".
    // Stream until first user; never load the whole file.
    let first_message =
        if let Some(text) = first_user_prompt_from_chat_history_path(&chat_history_path).await {
            truncate_chars(&text, 60)
        } else if message_count == 0 {
            // Empty draft: keep a generic title so stale-empty prune can match.
            // Do not fall through to generated_title / session_id here.
            "Grok Session".to_string()
        } else {
            title
                .map(|text| truncate_chars(&text, 60))
                .unwrap_or_else(|| session_id.to_string())
        };

    let file_size_bytes = std::fs::metadata(&chat_history_path)
        .or_else(|_| std::fs::metadata(&summary_path))
        .ok()
        .map(|metadata| metadata.len());

    let session_kind = summary_value
        .as_ref()
        .and_then(|summary| summary.get("session_kind"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    let resolved_parent = parent_session_id.or({
        // 若 summary 标明 subagent 但 map 未命中，不猜父会话
        None
    });

    GrokSessionSummary {
        canonical_session_id: Some(session_id.to_string()),
        session_id: session_id.to_string(),
        first_message,
        updated_at,
        created_at,
        message_count,
        file_size_bytes,
        engine: Some("grok".to_string()),
        attribution_status: Some("strict-match".to_string()),
        parent_session_id: resolved_parent,
        session_kind,
    }
}

/// Collect `(session_id, session_dir)` pairs whose decoded cwd matches the
/// workspace path variants.
async fn resolve_workspace_session_dirs(
    workspace_path: &Path,
    custom_home: Option<&str>,
) -> Vec<(String, PathBuf)> {
    let sessions_root = resolve_grok_base_dir(custom_home).join("sessions");
    let workspace_variants = build_workspace_path_variants(workspace_path);
    let mut matches = Vec::new();

    let mut cwd_dirs = match fs::read_dir(&sessions_root).await {
        Ok(dirs) => dirs,
        Err(_) => return matches,
    };
    while let Ok(Some(cwd_entry)) = cwd_dirs.next_entry().await {
        let cwd_path = cwd_entry.path();
        if !cwd_path.is_dir() {
            continue;
        }
        let Some(encoded_name) = cwd_path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let decoded_cwd = url_decode_dir_name(encoded_name);
        if decoded_cwd.trim().is_empty()
            || !matches_workspace_path(&decoded_cwd, &workspace_variants)
        {
            continue;
        }
        let mut session_dirs = match fs::read_dir(&cwd_path).await {
            Ok(dirs) => dirs,
            Err(_) => continue,
        };
        while let Ok(Some(session_entry)) = session_dirs.next_entry().await {
            let session_path = session_entry.path();
            if !session_path.is_dir() {
                continue;
            }
            let Some(session_id) = session_path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if session_id.trim().is_empty() {
                continue;
            }
            matches.push((session_id.to_string(), session_path));
        }
    }
    matches
}

/// List Grok sessions for a workspace path.
pub async fn list_grok_sessions(
    workspace_path: &Path,
    limit: Option<usize>,
    custom_home: Option<&str>,
) -> Result<Vec<GrokSessionSummary>, String> {
    timeout(LOCAL_SESSION_SCAN_TIMEOUT, async {
        let session_dirs = resolve_workspace_session_dirs(workspace_path, custom_home).await;
        let parent_map = build_grok_subagent_parent_map(&session_dirs).await;
        let mut sessions = Vec::new();
        for (session_id, session_dir) in session_dirs {
            let parent = parent_map.get(&session_id).cloned();
            sessions.push(build_summary_from_session_dir(&session_id, &session_dir, parent).await);
        }
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        sessions.truncate(limit.unwrap_or(200));
        Ok(sessions)
    })
    .await
    .map_err(|_| "Grok session scan timed out".to_string())?
}

async fn find_workspace_session_dir(
    workspace_path: &Path,
    session_id: &str,
    custom_home: Option<&str>,
) -> Result<PathBuf, String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let sessions_root = resolve_grok_base_dir(custom_home).join("sessions");

    // O(1) candidates: sessions/<urlencode(cwd-variant)>/<session_id>/
    for encoded_cwd in candidate_encoded_cwd_names(workspace_path) {
        let candidate = sessions_root
            .join(&encoded_cwd)
            .join(&normalized_session_id);
        if session_dir_looks_valid(&candidate) {
            return Ok(candidate);
        }
    }

    // Fallback: workspace-filtered scan (encoding edge cases / older layouts).
    let session_dirs = timeout(
        LOCAL_SESSION_SCAN_TIMEOUT,
        resolve_workspace_session_dirs(workspace_path, custom_home),
    )
    .await
    .map_err(|_| "Grok session scan timed out".to_string())?;
    session_dirs
        .into_iter()
        .find(|(candidate, _)| candidate.trim() == normalized_session_id)
        .map(|(_, session_dir)| session_dir)
        .ok_or_else(|| format!("Grok session not found: {}", normalized_session_id))
}

/// Load full Grok session messages by session id.
pub async fn load_grok_session(
    workspace_path: &Path,
    session_id: &str,
    custom_home: Option<&str>,
) -> Result<GrokSessionLoadResult, String> {
    let session_dir = find_workspace_session_dir(workspace_path, session_id, custom_home).await?;
    let chat_history_path = session_dir.join("chat_history.jsonl");
    // Stream line-by-line; never load multi-MB history as one String.
    let file = std::fs::File::open(&chat_history_path).map_err(|error| {
        format!(
            "Failed to read Grok session chat history {}: {}",
            chat_history_path.display(),
            error
        )
    })?;
    let reader = StdBufReader::new(file);
    parse_messages_from_chat_history_reader(reader)
}

/// Delete a Grok session: remove the whole session directory.
pub async fn delete_grok_session(
    workspace_path: &Path,
    session_id: &str,
    custom_home: Option<&str>,
) -> Result<(), String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let session_dir =
        find_workspace_session_dir(workspace_path, &normalized_session_id, custom_home).await?;

    if session_dir.exists() {
        fs::remove_dir_all(&session_dir).await.map_err(|error| {
            format!(
                "[IO_ERROR] Failed to delete Grok session dir {}: {}",
                session_dir.display(),
                error
            )
        })?;
    }

    Ok(())
}

#[cfg(test)]
#[path = "grok_history_tests.rs"]
mod grok_history_tests;
