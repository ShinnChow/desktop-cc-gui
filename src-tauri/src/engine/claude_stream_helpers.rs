use serde_json::Value;

pub(super) fn concat_text_blocks(blocks: &[Value]) -> Option<String> {
    let mut combined = String::new();
    for block in blocks {
        let kind = block.get("type").and_then(|t| t.as_str());
        if kind == Some("text") {
            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                combined = merge_text_chunks(&combined, text);
            }
        }
    }

    if combined.trim().is_empty() {
        return None;
    }

    Some(combined)
}

pub(super) fn extract_reasoning_fragment(block: &Value) -> Option<&str> {
    block
        .get("thinking")
        .and_then(|t| t.as_str())
        .or_else(|| block.get("reasoning").and_then(|t| t.as_str()))
        .or_else(|| block.get("text").and_then(|t| t.as_str()))
}

pub(super) fn concat_reasoning_blocks(blocks: &[Value]) -> Option<String> {
    let mut combined = String::new();
    for block in blocks {
        let kind = block.get("type").and_then(|t| t.as_str());
        if kind == Some("thinking") || kind == Some("reasoning") {
            if let Some(text) = extract_reasoning_fragment(block) {
                combined = merge_text_chunks(&combined, text);
            }
        }
    }

    if combined.trim().is_empty() {
        return None;
    }

    Some(combined)
}

pub(super) fn merge_text_chunks(existing: &str, incoming: &str) -> String {
    if incoming.is_empty() {
        return existing.to_string();
    }
    if existing.is_empty() {
        return incoming.to_string();
    }
    if incoming == existing || existing.contains(incoming) {
        return existing.to_string();
    }
    if incoming.starts_with(existing) || incoming.contains(existing) {
        return incoming.to_string();
    }
    if existing.starts_with(incoming) {
        return existing.to_string();
    }

    let mut boundaries: Vec<usize> = incoming.char_indices().map(|(idx, _)| idx).collect();
    boundaries.push(incoming.len());
    for boundary in boundaries.into_iter().rev() {
        if boundary == 0 {
            continue;
        }
        let prefix = &incoming[..boundary];
        if existing.ends_with(prefix) {
            return format!("{}{}", existing, &incoming[boundary..]);
        }
    }

    format!("{}{}", existing, incoming)
}

pub(super) fn parse_claude_stream_json_line(line: &str) -> Result<Value, serde_json::Error> {
    let trimmed = line.trim();
    if let Some(payload) = trimmed.strip_prefix("data:") {
        return serde_json::from_str(payload.trim());
    }
    serde_json::from_str(trimmed)
}

pub(super) fn is_claude_stream_control_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed == "[DONE]"
        || trimmed.eq_ignore_ascii_case("data: [DONE]")
        || trimmed.starts_with("event:")
}

pub(super) fn extract_delta_text_from_event(event: &Value) -> Option<String> {
    let part = event.get("part");
    for text in [
        event.get("delta").and_then(|value| value.as_str()),
        event.get("text").and_then(|value| value.as_str()),
        part.and_then(|value| value.get("delta"))
            .and_then(|value| value.as_str()),
        part.and_then(|value| value.get("text"))
            .and_then(|value| value.as_str()),
        part.and_then(|value| value.get("content"))
            .and_then(|value| value.as_str()),
    ]
    .into_iter()
    .flatten()
    {
        if !text.is_empty() {
            return Some(text.to_string());
        }
    }
    None
}

pub(super) fn extract_tool_result_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
        return None;
    }
    if let Some(obj) = value.as_object() {
        for key in [
            "output",
            "stdout",
            "stderr",
            "text",
            "preview",
            "message",
            "error",
            "response",
            "result",
            "content",
            "tool_output",
            "file",
            "loaded",
            "todos",
        ] {
            if let Some(nested) = obj.get(key).and_then(extract_tool_result_text) {
                return Some(nested);
            }
        }
        if obj
            .get("type")
            .and_then(|t| t.as_str())
            .map(|t| t == "text")
            .unwrap_or(false)
        {
            if let Some(text) = obj.get("text").and_then(|t| t.as_str()) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
        if !obj.is_empty() {
            let rendered = serde_json::to_string_pretty(obj).ok()?;
            if !rendered.trim().is_empty() {
                return Some(rendered);
            }
        }
    }
    if let Some(arr) = value.as_array() {
        let parts: Vec<String> = arr
            .iter()
            .filter_map(extract_tool_result_text)
            .filter(|text| !text.trim().is_empty())
            .collect();
        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }
    None
}

fn explicit_error_flag(value: &Value) -> Option<bool> {
    value
        .get("is_error")
        .or_else(|| value.get("isError"))
        .and_then(|field| field.as_bool())
}

fn has_error_payload(value: &Value) -> bool {
    let Some(error) = value.get("error") else {
        return false;
    };

    match error {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::String(value) => !value.trim().is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
        Value::Number(_) => true,
    }
}

pub(super) fn tool_result_is_error(block: &Value, event: &Value) -> bool {
    explicit_error_flag(block)
        .or_else(|| explicit_error_flag(event))
        .unwrap_or_else(|| {
            has_error_payload(block)
                || event
                    .get("toolUseResult")
                    .or_else(|| event.get("tool_use_result"))
                    .map(has_error_payload)
                    .unwrap_or(false)
        })
}

pub(super) fn extract_tool_result_output(block: &Value, event: &Value) -> Option<String> {
    block
        .get("content")
        .or_else(|| block.get("tool_output"))
        .or_else(|| block.get("output"))
        .or_else(|| block.get("result"))
        .and_then(extract_tool_result_text)
        .or_else(|| {
            event
                .get("toolUseResult")
                .and_then(extract_tool_result_text)
        })
        .or_else(|| {
            event
                .get("tool_use_result")
                .and_then(extract_tool_result_text)
        })
}

pub(super) fn tool_input_signature(value: &Value) -> Option<String> {
    serde_json::to_string(value).ok()
}

pub(super) fn extract_claude_tool_name(value: &Value) -> Option<String> {
    value
        .get("name")
        .or_else(|| value.get("tool_name"))
        .and_then(|field| field.as_str())
        .map(str::trim)
        .filter(|field| !field.is_empty())
        .map(ToString::to_string)
}

pub(super) fn extract_claude_tool_input(value: &Value) -> Option<Value> {
    value
        .get("input")
        .cloned()
        .or_else(|| value.get("tool_input").cloned())
}

pub(super) fn extract_string_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(raw) = value.get(*key).and_then(|v| v.as_str()) {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

pub(super) fn extract_text_from_content(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
        return None;
    }
    if let Some(obj) = value.as_object() {
        if obj
            .get("type")
            .and_then(|t| t.as_str())
            .map(|t| t == "text")
            .unwrap_or(false)
        {
            if let Some(text) = obj.get("text").and_then(|t| t.as_str()) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    if let Some(arr) = value.as_array() {
        return concat_text_blocks(arr);
    }
    None
}

pub(super) fn extract_result_text(event: &Value) -> Option<String> {
    let content = event
        .get("message")
        .and_then(|m| m.get("content"))
        .or_else(|| event.get("content"))
        .or_else(|| {
            event
                .get("result")
                .and_then(|r| r.get("message"))
                .and_then(|m| m.get("content"))
        })
        .or_else(|| event.get("result").and_then(|r| r.get("content")));
    content.and_then(extract_text_from_content)
}

pub(super) fn looks_like_claude_runtime_error(line: &str) -> bool {
    let text = line.trim();
    if text.is_empty() {
        return false;
    }
    let lower = text.to_ascii_lowercase();
    lower.starts_with("api error:")
        || lower.contains("unexpected end of json input")
        || lower.starts_with("error:")
}

// ---------------------------------------------------------------------------
// Structured background-task settlement helpers (issue #983)
// ---------------------------------------------------------------------------

/// Max accepted length for a single structured `backgroundTaskId`.
pub(super) const CLAUDE_BG_TASK_ID_MAX_LEN: usize = 128;
/// Max turn-scoped active background-task ids (malicious stream budget).
pub(super) const CLAUDE_BG_TASK_SET_MAX: usize = 64;

/// Terminal task-notification statuses that release a settlement blocker.
const CLAUDE_BG_TASK_TERMINAL_STATUSES: &[&str] = &["completed", "failed", "stopped"];

/// Normalize and validate a structured background task id.
pub(super) fn normalize_background_task_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > CLAUDE_BG_TASK_ID_MAX_LEN {
        return None;
    }
    Some(trimmed.to_string())
}

fn background_task_id_from_value(value: &Value) -> Option<String> {
    let obj = value.as_object()?;
    for key in ["backgroundTaskId", "background_task_id"] {
        if let Some(raw) = obj.get(key).and_then(|v| v.as_str()) {
            if let Some(id) = normalize_background_task_id(raw) {
                return Some(id);
            }
        }
    }
    None
}

/// Extract structured `backgroundTaskId` from a Claude stream-json event.
///
/// Only structured fields are accepted — never prose heuristics.
pub(super) fn extract_background_task_id(event: &Value) -> Option<String> {
    event
        .get("toolUseResult")
        .and_then(background_task_id_from_value)
        .or_else(|| {
            event
                .get("tool_use_result")
                .and_then(background_task_id_from_value)
        })
}

/// Extract a Task/Agent async-launch id from a structured `task_started` system event.
///
/// Agent/Task async-launch tool results use a different field shape than Bash
/// `backgroundTaskId`, and the CLI defers this turn's own `result` until every
/// pending Agent/Task subagent has settled. This reads `task_started.task_id`
/// directly — the same field `extract_terminal_task_release_id` matches against.
pub(super) fn extract_task_started_id(event: &Value) -> Option<String> {
    let is_task_started = event.get("type").and_then(|v| v.as_str()) == Some("system")
        && event.get("subtype").and_then(|v| v.as_str()) == Some("task_started");
    if !is_task_started {
        return None;
    }
    event
        .get("task_id")
        .and_then(|v| v.as_str())
        .and_then(normalize_background_task_id)
}

/// Whether a task-notification status is terminal for blocker release.
pub(super) fn is_terminal_background_task_status(status: &str) -> bool {
    let lower = status.trim().to_ascii_lowercase();
    CLAUDE_BG_TASK_TERMINAL_STATUSES
        .iter()
        .any(|candidate| *candidate == lower)
}

/// Grace force-kill gate: only when result seen, no blockers, and grace elapsed.
pub(super) fn can_force_kill_for_grace(
    result_seen: bool,
    active_blockers_empty: bool,
    grace_elapsed: bool,
) -> bool {
    result_seen && active_blockers_empty && grace_elapsed
}

/// Try to insert a background task id into a turn-scoped set with budget limits.
///
/// Returns `true` if the id is present in the set after the call (including
/// pre-existing membership). Returns `false` when the id is rejected (invalid
/// or set at capacity without already containing the id).
pub(super) fn try_register_background_task_id(
    active: &mut std::collections::HashSet<String>,
    raw_id: &str,
) -> bool {
    let Some(id) = normalize_background_task_id(raw_id) else {
        return false;
    };
    if active.contains(&id) {
        return true;
    }
    if active.len() >= CLAUDE_BG_TASK_SET_MAX {
        return false;
    }
    active.insert(id);
    true
}

/// Release one blocker only when task-id matches and status is terminal.
pub(super) fn try_release_background_task_id(
    active: &mut std::collections::HashSet<String>,
    task_id: &str,
    status: &str,
) -> bool {
    if !is_terminal_background_task_status(status) {
        return false;
    }
    let Some(id) = normalize_background_task_id(task_id) else {
        return false;
    };
    active.remove(&id)
}

fn decode_xml_entities_light(text: &str) -> String {
    let mut decoded = text.to_string();
    for _ in 0..3 {
        let next = decoded
            .replace("&lt;", "<")
            .replace("&#60;", "<")
            .replace("&#x3c;", "<")
            .replace("&#x3C;", "<")
            .replace("&gt;", ">")
            .replace("&#62;", ">")
            .replace("&#x3e;", ">")
            .replace("&#x3E;", ">")
            .replace("&amp;", "&")
            .replace("&#38;", "&")
            .replace("&#x26;", "&");
        if next == decoded {
            break;
        }
        decoded = next;
    }
    decoded
}

fn extract_xml_tag_value(block: &str, tag_name: &str) -> Option<String> {
    let open = format!("<{tag_name}>");
    let close = format!("</{tag_name}>");
    let lower = block.to_ascii_lowercase();
    let open_lower = open.to_ascii_lowercase();
    let close_lower = close.to_ascii_lowercase();
    let start = lower.find(&open_lower)? + open.len();
    let end_rel = lower[start..].find(&close_lower)?;
    let value = block[start..start + end_rel].trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

/// Parse `<task-notification>` XML (and light entity-escaped forms) for settlement.
///
/// Returns `(task_id, status)` when both are present. Does not require `<result>`.
pub(super) fn parse_task_notification_xml(text: &str) -> Option<(String, String)> {
    let trimmed = text.trim_start();
    if trimmed.is_empty() {
        return None;
    }
    let first = trimmed.chars().next()?;
    let candidate = if first == '<' {
        trimmed.to_string()
    } else if first == '&' {
        decode_xml_entities_light(trimmed)
    } else {
        return None;
    };
    let lower = candidate.to_ascii_lowercase();
    // Align with FE agentTaskNotification: envelope must start the trimmed payload
    // (rejects mid-prose demos that merely mention the markup).
    if !lower.starts_with("<task-notification>") {
        return None;
    }
    let block = candidate.as_str();
    let task_id = extract_xml_tag_value(block, "task-id")
        .or_else(|| extract_xml_tag_value(block, "taskId"))?;
    let status = extract_xml_tag_value(block, "status")?;
    Some((task_id, status))
}

fn structured_task_notification_from_object(obj: &Value) -> Option<(String, String)> {
    let task_id = extract_string_field(obj, &["taskId", "task_id", "task-id"])?;
    let status = extract_string_field(obj, &["status"])?;
    Some((task_id, status))
}

fn collect_text_candidates_for_notification(event: &Value) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(text) = extract_result_text(event) {
        out.push(text);
    }
    for key in ["text", "content", "result", "message"] {
        if let Some(value) = event.get(key) {
            if let Some(text) = value.as_str() {
                if !text.trim().is_empty() {
                    out.push(text.to_string());
                }
            } else if let Some(text) = extract_text_from_content(value) {
                out.push(text);
            } else if let Some(nested) = value.get("content").and_then(extract_text_from_content) {
                out.push(nested);
            } else if let Some(nested) = value.get("text").and_then(|t| t.as_str()) {
                if !nested.trim().is_empty() {
                    out.push(nested.to_string());
                }
            }
        }
    }
    out
}

/// Extract a task notification pair from a stream event (structured or XML text).
pub(super) fn extract_task_notification(event: &Value) -> Option<(String, String)> {
    if let Some(pair) = structured_task_notification_from_object(event) {
        return Some(pair);
    }
    for key in ["taskNotification", "task_notification", "notification"] {
        if let Some(nested) = event.get(key) {
            if let Some(pair) = structured_task_notification_from_object(nested) {
                return Some(pair);
            }
        }
    }
    for text in collect_text_candidates_for_notification(event) {
        if let Some(pair) = parse_task_notification_xml(&text) {
            return Some(pair);
        }
    }
    None
}

/// If the notification is terminal, return the task id to release; else None.
pub(super) fn extract_terminal_task_release_id(event: &Value) -> Option<String> {
    let (task_id, status) = extract_task_notification(event)?;
    if !is_terminal_background_task_status(&status) {
        return None;
    }
    normalize_background_task_id(&task_id)
}

#[cfg(test)]
mod background_task_settlement_tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashSet;

    #[test]
    fn extract_background_task_id_reads_camel_and_snake() {
        let camel = json!({
            "type": "user",
            "toolUseResult": { "backgroundTaskId": "bg-1" }
        });
        assert_eq!(extract_background_task_id(&camel).as_deref(), Some("bg-1"));

        let snake = json!({
            "tool_use_result": { "background_task_id": "  bg-2  " }
        });
        assert_eq!(extract_background_task_id(&snake).as_deref(), Some("bg-2"));
    }

    #[test]
    fn extract_background_task_id_ignores_empty_and_prose() {
        let empty = json!({ "toolUseResult": { "backgroundTaskId": "   " } });
        assert!(extract_background_task_id(&empty).is_none());

        let prose = json!({
            "type": "assistant",
            "message": {
                "content": [{ "type": "text", "text": "running in background task bg-9" }]
            }
        });
        assert!(extract_background_task_id(&prose).is_none());
    }

    #[test]
    fn extract_background_task_id_rejects_overlong_id() {
        let long_id = "x".repeat(CLAUDE_BG_TASK_ID_MAX_LEN + 1);
        let event = json!({ "toolUseResult": { "backgroundTaskId": long_id } });
        assert!(extract_background_task_id(&event).is_none());
    }

    #[test]
    fn extract_task_started_id_reads_top_level_task_id() {
        let event = json!({
            "type": "system",
            "subtype": "task_started",
            "task_id": "agent-1",
            "tool_use_id": "toolu_1"
        });
        assert_eq!(extract_task_started_id(&event).as_deref(), Some("agent-1"));
    }

    #[test]
    fn extract_task_started_id_ignores_other_subtypes_and_event_types() {
        let wrong_subtype = json!({
            "type": "system",
            "subtype": "task_updated",
            "task_id": "agent-1"
        });
        assert!(extract_task_started_id(&wrong_subtype).is_none());

        let wrong_type = json!({
            "type": "assistant",
            "subtype": "task_started",
            "task_id": "agent-1"
        });
        assert!(extract_task_started_id(&wrong_type).is_none());

        let missing_id = json!({ "type": "system", "subtype": "task_started" });
        assert!(extract_task_started_id(&missing_id).is_none());
    }

    #[test]
    fn extract_task_started_id_rejects_empty_and_overlong() {
        let empty = json!({ "type": "system", "subtype": "task_started", "task_id": "   " });
        assert!(extract_task_started_id(&empty).is_none());

        let long_id = "x".repeat(CLAUDE_BG_TASK_ID_MAX_LEN + 1);
        let overlong = json!({ "type": "system", "subtype": "task_started", "task_id": long_id });
        assert!(extract_task_started_id(&overlong).is_none());
    }

    #[test]
    fn register_is_idempotent_and_respects_budget() {
        let mut active = HashSet::new();
        assert!(try_register_background_task_id(&mut active, "a"));
        assert!(try_register_background_task_id(&mut active, "a"));
        assert_eq!(active.len(), 1);

        active.clear();
        for i in 0..CLAUDE_BG_TASK_SET_MAX {
            assert!(try_register_background_task_id(
                &mut active,
                &format!("id-{i}")
            ));
        }
        assert_eq!(active.len(), CLAUDE_BG_TASK_SET_MAX);
        assert!(!try_register_background_task_id(&mut active, "overflow"));
        // Pre-existing membership still reports true without growing.
        assert!(try_register_background_task_id(&mut active, "id-0"));
        assert_eq!(active.len(), CLAUDE_BG_TASK_SET_MAX);
    }

    #[test]
    fn release_requires_matching_terminal_status() {
        let mut active = HashSet::from(["bg-1".to_string()]);
        assert!(!try_release_background_task_id(
            &mut active,
            "bg-1",
            "running"
        ));
        assert!(active.contains("bg-1"));

        assert!(!try_release_background_task_id(
            &mut active,
            "bg-other",
            "completed"
        ));
        assert!(active.contains("bg-1"));

        assert!(try_release_background_task_id(
            &mut active,
            "bg-1",
            "Completed"
        ));
        assert!(active.is_empty());
    }

    #[test]
    fn parse_task_notification_xml_reads_status_and_id() {
        let text = r#"
<task-notification>
<task-id>bg-1</task-id>
<status>completed</status>
<summary>done</summary>
<result>ok</result>
</task-notification>
"#;
        assert_eq!(
            parse_task_notification_xml(text),
            Some(("bg-1".to_string(), "completed".to_string()))
        );
    }

    #[test]
    fn parse_task_notification_xml_entity_escaped() {
        let text = r#"
&lt;task-notification&gt;
&lt;task-id&gt;bg-9&lt;/task-id&gt;
&lt;status&gt;failed&lt;/status&gt;
"#;
        assert_eq!(
            parse_task_notification_xml(text),
            Some(("bg-9".to_string(), "failed".to_string()))
        );
    }

    #[test]
    fn extract_terminal_release_from_assistant_text_event() {
        let event = json!({
            "type": "assistant",
            "message": {
                "content": [{
                    "type": "text",
                    "text": "<task-notification><task-id>bg-1</task-id><status>stopped</status><result>x</result></task-notification>"
                }]
            }
        });
        assert_eq!(
            extract_terminal_task_release_id(&event).as_deref(),
            Some("bg-1")
        );
    }

    #[test]
    fn non_terminal_notification_does_not_release() {
        let event = json!({
            "text": "<task-notification><task-id>bg-1</task-id><status>running</status></task-notification>"
        });
        assert!(extract_terminal_task_release_id(&event).is_none());
    }

    #[test]
    fn can_force_kill_for_grace_matrix() {
        assert!(!can_force_kill_for_grace(false, true, true));
        assert!(!can_force_kill_for_grace(true, false, true));
        assert!(!can_force_kill_for_grace(true, true, false));
        assert!(can_force_kill_for_grace(true, true, true));
    }

    #[test]
    fn mid_prose_task_notification_demo_is_ignored() {
        let text = "这里演示 XML：<task-notification><task-id>x</task-id><status>completed</status></task-notification>";
        assert!(parse_task_notification_xml(text).is_none());
    }
}
