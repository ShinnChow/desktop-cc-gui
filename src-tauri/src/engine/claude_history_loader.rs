use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, BufReader};

use super::filter::{
    all_claude_project_dirs, claude_project_dirs_for_path, claude_projects_dir,
    is_claude_meta_entry, normalize_session_id,
};
use super::super::claude_history_entries::{
    classify_claude_history_entry, ClaudeHistoryEntryClassification, ClaudeHistoryHiddenReason,
    ClaudeLocalControlEvent, CLAUDE_CONTROL_EVENT_TOOL_TYPE,
};
use super::super::claude_history_large_payload::{
    extract_images_and_deferred_from_content, ClaudeDeferredImage,
};
use super::super::claude_history_subagents::ClaudeSubagentSessionId;
use super::super::EngineConfig;

fn claude_control_event_message(
    event: ClaudeLocalControlEvent,
    id: String,
    timestamp: Option<String>,
) -> ClaudeSessionMessage {
    ClaudeSessionMessage {
        id,
        role: "system".to_string(),
        text: event.detail.clone(),
        images: None,
        deferred_images: None,
        timestamp,
        kind: "tool".to_string(),
        tool_type: Some(CLAUDE_CONTROL_EVENT_TOOL_TYPE.to_string()),
        title: Some(event.event_type.title().to_string()),
        tool_input: Some(serde_json::json!({
            "eventType": event.event_type.as_str(),
            "source": "claude-history",
        })),
        tool_output: Some(serde_json::json!({
            "detail": event.detail,
            "eventType": event.event_type.as_str(),
            "source": "claude-history",
        })),
        status: Some(event.event_type.status().to_string()),
    }
}

/// A single message from a Claude Code session, suitable for frontend display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deferred_images: Option<Vec<ClaudeDeferredImage>>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// Usage data extracted from Claude session
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionUsage {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_creation_input_tokens: Option<i64>,
    pub cache_read_input_tokens: Option<i64>,
}

/// Result of loading a Claude session, including messages and usage data
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionLoadResult {
    pub messages: Vec<ClaudeSessionMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<ClaudeSessionUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_more: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

pub(crate) const CLAUDE_WINDOW_TAIL_CHUNK: u64 = 256 * 1024;

pub(crate) fn rewrite_session_id_fields(value: &mut Value, source_session_id: &str, forked_session_id: &str) {
    match value {
        Value::Object(map) => {
            for (key, nested) in map.iter_mut() {
                if (key == "session_id" || key == "sessionId")
                    && nested
                        .as_str()
                        .map(|sid| sid == source_session_id)
                        .unwrap_or(false)
                {
                    *nested = Value::String(forked_session_id.to_string());
                    continue;
                }
                rewrite_session_id_fields(nested, source_session_id, forked_session_id);
            }
        }
        Value::Array(items) => {
            for item in items {
                rewrite_session_id_fields(item, source_session_id, forked_session_id);
            }
        }
        _ => {}
    }
}

pub(crate) fn resolve_session_file_path(
    base_dir: &Path,
    workspace_path: &Path,
    session_id: &str,
) -> Result<PathBuf, String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let project_dirs = claude_project_dirs_for_path(base_dir, workspace_path);
    for project_dir in project_dirs {
        let candidate = project_dir.join(format!("{}.jsonl", normalized_session_id));
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(format!("Session file not found: {}", normalized_session_id))
}

fn claude_session_file_search_dirs(base_dir: &Path, workspace_path: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut seen = HashSet::new();
    for dir in claude_project_dirs_for_path(base_dir, workspace_path)
        .into_iter()
        .chain(all_claude_project_dirs(base_dir))
    {
        if seen.insert(dir.clone()) {
            dirs.push(dir);
        }
    }
    dirs
}

pub(crate) fn is_target_user_message_entry(entry: &Value, target_message_id: &str) -> bool {
    let role = entry
        .get("message")
        .and_then(|message| message.get("role"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if role != "user" {
        return false;
    }
    entry
        .get("uuid")
        .and_then(|value| value.as_str())
        .or_else(|| {
            entry
                .get("message")
                .and_then(|message| message.get("id"))
                .and_then(|value| value.as_str())
        })
        .map(|value| value == target_message_id)
        .unwrap_or(false)
}

pub async fn load_claude_session_with_config(
    workspace_path: &Path,
    session_id: &str,
    config: Option<&EngineConfig>,
) -> Result<ClaudeSessionLoadResult, String> {
    load_claude_session_with_config_window(workspace_path, session_id, config, None, None).await
}

pub async fn load_claude_session_with_config_window(
    workspace_path: &Path,
    session_id: &str,
    config: Option<&EngineConfig>,
    limit: Option<usize>,
    before: Option<&str>,
) -> Result<ClaudeSessionLoadResult, String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    load_claude_session_from_base_dir_window(
        &base_dir,
        workspace_path,
        &normalized_session_id,
        limit,
        before,
    )
    .await
}

pub(crate) fn find_claude_session_file(
    base_dir: &Path,
    workspace_path: &Path,
    session_id: &str,
) -> Result<PathBuf, String> {
    let project_dirs = claude_session_file_search_dirs(base_dir, workspace_path);
    for project_dir in project_dirs {
        let candidate = if let Some(subagent_id) = ClaudeSubagentSessionId::parse(session_id) {
            subagent_id.transcript_path(&project_dir)
        } else {
            project_dir.join(format!("{}.jsonl", session_id))
        };
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!("Session file not found: {}", session_id))
}

pub(crate) fn resolve_claude_session_file_with_config(
    workspace_path: &Path,
    session_id: &str,
    config: Option<&EngineConfig>,
) -> Result<PathBuf, String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    find_claude_session_file(&base_dir, workspace_path, &normalized_session_id)
}

async fn read_claude_tail_window_bytes(
    path: &Path,
    end_exclusive: u64,
) -> Result<(u64, Vec<u8>), String> {
    let start = end_exclusive.saturating_sub(CLAUDE_WINDOW_TAIL_CHUNK);
    let mut file = fs::File::open(path)
        .await
        .map_err(|error| format!("Failed to open session file: {}", error))?;
    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(|error| format!("Failed to seek session file: {}", error))?;
    let mut buf = vec![0u8; (end_exclusive.saturating_sub(start)) as usize];
    let mut read = 0usize;
    while read < buf.len() {
        let n = file
            .read(&mut buf[read..])
            .await
            .map_err(|error| format!("Failed to read session file: {}", error))?;
        if n == 0 {
            break;
        }
        read += n;
    }
    buf.truncate(read);
    Ok((start, buf))
}

async fn load_claude_session_window_from_path(
    path: &Path,
    session_id: &str,
    limit: usize,
    before: Option<&str>,
) -> Result<ClaudeSessionLoadResult, String> {
    let file_len = fs::metadata(path)
        .await
        .map_err(|error| format!("Failed to stat session file: {}", error))?
        .len();
    let mut end = before
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value <= file_len)
        .unwrap_or(file_len);
    // fix-claude-history-window-message-loss：整段组装、只对首段做一次行对齐。
    // 旧实现逐 chunk drop 首行残段，跨界行尾部被丢弃后与下一完整行粘成非法 JSON，
    // 被解析循环静默跳过（每个 256KB chunk 边界丢 2 行）。
    let mut assembled: Vec<u8> = Vec::new();
    let mut window_start = end;
    let mut newline_count = 0usize;
    while end > 0 {
        let (start, bytes) = read_claude_tail_window_bytes(path, end).await?;
        window_start = start;
        newline_count += bytes.iter().filter(|byte| **byte == b'\n').count();
        assembled.splice(0..0, bytes);
        if newline_count >= limit.saturating_mul(4) || start == 0 {
            break;
        }
        end = start;
    }
    if window_start > 0 {
        match assembled.iter().position(|byte| *byte == b'\n') {
            Some(newline) => {
                window_start += newline as u64 + 1;
                assembled = assembled.split_off(newline + 1);
            }
            None => {
                // 整个 window 是一条未终止片段（单行大于 byte window）：
                // fail-closed，本页不产出消息；完整行由更早分页携带。
                assembled.clear();
            }
        }
    }
    let has_more = window_start > 0;
    let mut result = parse_claude_session_from_reader(
        BufReader::new(std::io::Cursor::new(assembled)),
        session_id,
    )
    .await?;
    // 不再 drain：window 与分页均按行对齐，全量返回保证页间连续无损。
    // 旧 drain 在 window_start == 0 时产出死游标 "0"（旧消息永远无法翻页加载），
    // 在 window_start > 0 时把被裁行落在两页 byte 范围之间永久跳过。
    result.has_more = Some(has_more);
    result.next_cursor = if has_more {
        Some(window_start.to_string())
    } else {
        None
    };
    Ok(result)
}

pub(crate) async fn load_claude_session_from_base_dir_window(
    base_dir: &Path,
    workspace_path: &Path,
    session_id: &str,
    limit: Option<usize>,
    before: Option<&str>,
) -> Result<ClaudeSessionLoadResult, String> {
    let session_file = find_claude_session_file(base_dir, workspace_path, session_id)?;
    if let Some(limit) = limit.filter(|value| *value > 0) {
        return load_claude_session_window_from_path(&session_file, session_id, limit, before)
            .await;
    }
    let file = fs::File::open(&session_file)
        .await
        .map_err(|e| format!("Failed to open session file: {}", e))?;
    parse_claude_session_from_reader(BufReader::new(file), session_id).await
}

pub(crate) async fn load_claude_session_from_base_dir(
    base_dir: &Path,
    workspace_path: &Path,
    session_id: &str,
) -> Result<ClaudeSessionLoadResult, String> {
    load_claude_session_from_base_dir_window(base_dir, workspace_path, session_id, None, None).await
}

async fn parse_claude_session_from_reader<R: tokio::io::AsyncRead + Unpin>(
    reader: BufReader<R>,
    session_id: &str,
) -> Result<ClaudeSessionLoadResult, String> {
    let mut lines = reader.lines();

    let mut messages: Vec<ClaudeSessionMessage> = Vec::new();
    let mut last_usage: Option<ClaudeSessionUsage> = None;
    let mut counter: usize = 0;
    let mut line_index: usize = 0;
    let mut suppress_polluted_assistant_until_next_user = false;

    while let Ok(Some(line)) = lines.next_line().await {
        let current_line_index = line_index;
        line_index += 1;
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        let entry: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let classification = classify_claude_history_entry(&entry);
        if matches!(
            classification,
            ClaudeHistoryEntryClassification::Hidden(
                ClaudeHistoryHiddenReason::StreamJsonStdinPayload
            )
        ) {
            suppress_polluted_assistant_until_next_user = true;
            continue;
        }
        if matches!(classification, ClaudeHistoryEntryClassification::Hidden(_)) {
            continue;
        }

        let msg = match entry.get("message") {
            Some(m) => m,
            None => continue,
        };

        let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");

        if role != "user" && role != "assistant" {
            continue;
        }

        if suppress_polluted_assistant_until_next_user && role == "assistant" {
            continue;
        }
        if suppress_polluted_assistant_until_next_user
            && role == "user"
            && matches!(classification, ClaudeHistoryEntryClassification::Normal)
        {
            suppress_polluted_assistant_until_next_user = false;
        }

        // Extract usage data from assistant messages
        if role == "assistant" {
            if let Some(usage) = msg.get("usage") {
                last_usage = Some(ClaudeSessionUsage {
                    input_tokens: usage.get("input_tokens").and_then(|v| v.as_i64()),
                    output_tokens: usage.get("output_tokens").and_then(|v| v.as_i64()),
                    cache_creation_input_tokens: usage
                        .get("cache_creation_input_tokens")
                        .and_then(|v| v.as_i64()),
                    cache_read_input_tokens: usage
                        .get("cache_read_input_tokens")
                        .and_then(|v| v.as_i64()),
                });
            }
        }

        // Skip meta entries
        let is_meta = is_claude_meta_entry(&entry, Some(msg));
        if is_meta {
            continue;
        }

        let timestamp = entry
            .get("timestamp")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let uuid = entry.get("uuid").and_then(|v| v.as_str()).unwrap_or("");
        if let ClaudeHistoryEntryClassification::Displayable(event) = classification {
            counter += 1;
            let id = if uuid.is_empty() {
                format!("claude-control-event-{}", counter)
            } else {
                format!("{}-control-event", uuid)
            };
            messages.push(claude_control_event_message(event, id, timestamp));
            continue;
        }

        let content = msg.get("content");

        // Extract text and structured content from the message
        match content {
            Some(Value::String(text)) => {
                let text = text.trim();
                if text.is_empty() {
                    continue;
                }
                counter += 1;
                let id = if uuid.is_empty() {
                    format!("claude-msg-{}", counter)
                } else {
                    uuid.to_string()
                };
                messages.push(ClaudeSessionMessage {
                    id,
                    role: role.to_string(),
                    text: text.to_string(),
                    images: None,
                    deferred_images: None,
                    timestamp,
                    kind: "message".to_string(),
                    tool_type: None,
                    title: None,
                    tool_input: None,
                    tool_output: None,
                    status: None,
                });
            }
            Some(Value::Array(blocks)) => {
                // Process content blocks: text, thinking, tool_use, tool_result
                let mut text_parts: Vec<String> = Vec::new();
                let (image_sources, deferred_images) = extract_images_and_deferred_from_content(
                    &Value::Array(blocks.clone()),
                    session_id,
                    current_line_index,
                    if uuid.is_empty() { None } else { Some(uuid) },
                );

                for block in blocks {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");

                    match block_type {
                        "text" => {
                            if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                                let t = t.trim();
                                if !t.is_empty() {
                                    text_parts.push(t.to_string());
                                }
                            }
                        }
                        "thinking" | "reasoning" => {
                            // Extract thinking/reasoning content
                            let thinking_text = block
                                .get("thinking")
                                .or_else(|| block.get("reasoning"))
                                .or_else(|| block.get("text"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .trim();
                            if !thinking_text.is_empty() {
                                counter += 1;
                                let id = if uuid.is_empty() {
                                    format!("claude-reasoning-{}", counter)
                                } else {
                                    format!("{}-reasoning", uuid)
                                };
                                messages.push(ClaudeSessionMessage {
                                    id,
                                    role: role.to_string(),
                                    text: thinking_text.to_string(),
                                    images: None,
                                    deferred_images: None,
                                    timestamp: timestamp.clone(),
                                    kind: "reasoning".to_string(),
                                    tool_type: None,
                                    title: None,
                                    tool_input: None,
                                    tool_output: None,
                                    status: None,
                                });
                            }
                        }
                        "tool_use" => {
                            let tool_name =
                                block.get("name").and_then(|v| v.as_str()).unwrap_or("tool");
                            let input = block
                                .get("input")
                                .map(|v| serde_json::to_string_pretty(v).unwrap_or_default())
                                .unwrap_or_default();
                            counter += 1;
                            let tool_id = block
                                .get("id")
                                .or_else(|| block.get("tool_use_id"))
                                .or_else(|| block.get("toolUseId"))
                                .or_else(|| block.get("tool_useId"))
                                .or_else(|| block.get("toolId"))
                                .or_else(|| block.get("tool_id"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let id = if tool_id.is_empty() {
                                format!("claude-tool-{}", counter)
                            } else {
                                tool_id.to_string()
                            };
                            messages.push(ClaudeSessionMessage {
                                id,
                                role: role.to_string(),
                                text: input,
                                images: None,
                                deferred_images: None,
                                timestamp: timestamp.clone(),
                                kind: "tool".to_string(),
                                tool_type: Some(tool_name.to_string()),
                                title: Some(tool_name.to_string()),
                                tool_input: block.get("input").cloned(),
                                tool_output: None,
                                status: None,
                            });
                        }
                        "tool_result" => {
                            let result_content = block
                                .get("content")
                                .and_then(|v| {
                                    if let Some(s) = v.as_str() {
                                        Some(s.to_string())
                                    } else if let Some(arr) = v.as_array() {
                                        // tool_result content can also be an array
                                        let texts: Vec<String> = arr
                                            .iter()
                                            .filter_map(|item| {
                                                if item.get("type").and_then(|t| t.as_str())
                                                    == Some("text")
                                                {
                                                    item.get("text")
                                                        .and_then(|t| t.as_str())
                                                        .map(|s| s.to_string())
                                                } else {
                                                    None
                                                }
                                            })
                                            .collect();
                                        if texts.is_empty() {
                                            None
                                        } else {
                                            Some(texts.join("\n"))
                                        }
                                    } else {
                                        None
                                    }
                                })
                                .unwrap_or_default();
                            if !result_content.is_empty() {
                                counter += 1;
                                let tool_use_id = block
                                    .get("tool_use_id")
                                    .or_else(|| block.get("toolUseId"))
                                    .or_else(|| block.get("tool_useId"))
                                    .or_else(|| block.get("toolUseID"))
                                    .or_else(|| block.get("toolId"))
                                    .or_else(|| block.get("tool_id"))
                                    .or_else(|| block.get("id"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let id = if tool_use_id.is_empty() {
                                    format!("claude-toolresult-{}", counter)
                                } else {
                                    format!("{}-result", tool_use_id)
                                };
                                let is_error = block
                                    .get("is_error")
                                    .or_else(|| block.get("isError"))
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false);
                                messages.push(ClaudeSessionMessage {
                                    id,
                                    role: "assistant".to_string(),
                                    text: result_content,
                                    images: None,
                                    deferred_images: None,
                                    timestamp: timestamp.clone(),
                                    kind: "tool".to_string(),
                                    tool_type: Some(if is_error {
                                        "error".to_string()
                                    } else {
                                        "result".to_string()
                                    }),
                                    title: Some(if is_error {
                                        "Error".to_string()
                                    } else {
                                        "Result".to_string()
                                    }),
                                    tool_input: None,
                                    tool_output: entry
                                        .get("toolUseResult")
                                        .cloned()
                                        .or_else(|| block.get("output").cloned()),
                                    status: None,
                                });
                            }
                        }
                        _ => {}
                    }
                }

                // Add accumulated text parts as a message
                if !text_parts.is_empty()
                    || !image_sources.is_empty()
                    || !deferred_images.is_empty()
                {
                    counter += 1;
                    let id = if uuid.is_empty() {
                        format!("claude-msg-{}", counter)
                    } else {
                        uuid.to_string()
                    };
                    messages.push(ClaudeSessionMessage {
                        id,
                        role: role.to_string(),
                        text: text_parts.join("\n\n"),
                        images: if image_sources.is_empty() {
                            None
                        } else {
                            Some(image_sources)
                        },
                        deferred_images: if deferred_images.is_empty() {
                            None
                        } else {
                            Some(deferred_images)
                        },
                        timestamp,
                        kind: "message".to_string(),
                        tool_type: None,
                        title: None,
                        tool_input: None,
                        tool_output: None,
                        status: None,
                    });
                }
            }
            _ => continue,
        }
    }

    Ok(ClaudeSessionLoadResult {
        messages,
        usage: last_usage,
        has_more: None,
        next_cursor: None,
    })
}
