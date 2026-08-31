use super::*;

pub(crate) enum PiStreamLine {
    SessionId(String),
    TurnStart,
    TurnEnd,
    TextDelta(String),
    ThinkingDelta(String),
    AssistantSnapshot(String),
    ToolStart {
        tool_id: String,
        tool_name: String,
        args: Option<Value>,
    },
    ToolEnd {
        tool_id: String,
        content: String,
        is_error: bool,
    },
    AssistantError(String),
    Usage(Value),
    /// `message_start` for `role:"custom"` + `customType:"background-task-notification"`
    /// (pi-background-tasks extension terminal wakeup). `message_end` carries an
    /// identical payload and is collapsed to `Other` for dedupe.
    BackgroundTaskNotification {
        details: Option<Value>,
        content: String,
    },
    Other,
}

/// Surface the extension's custom notification message once per wakeup:
/// `message_start` wins, the identical `message_end` collapses to `Other`.
pub(crate) fn parse_pi_custom_message_line(event_type: &str, message: Option<&Value>) -> PiStreamLine {
    let Some(message) = message else {
        return PiStreamLine::Other;
    };
    let custom_type = message
        .get("customType")
        .and_then(Value::as_str)
        .unwrap_or("");
    if custom_type != PI_BACKGROUND_TASK_NOTIFICATION_CUSTOM_TYPE {
        return PiStreamLine::Other;
    }
    if event_type != "message_start" {
        return PiStreamLine::Other;
    }
    let details = message
        .get("details")
        .cloned()
        .filter(|value| value.is_object());
    let content = message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if details.is_none() && content.trim().is_empty() {
        return PiStreamLine::Other;
    }
    PiStreamLine::BackgroundTaskNotification { details, content }
}

pub(crate) fn extract_tool_result_text(result: Option<&Value>) -> String {
    let Some(result) = result else {
        return String::new();
    };
    if let Some(text) = result.as_str() {
        return text.to_string();
    }
    if let Some(content) = result.get("content") {
        if let Some(text) = content.as_str() {
            return text.to_string();
        }
        if let Some(parts) = content.as_array() {
            let text = parts
                .iter()
                .filter_map(|part| {
                    if let Some(text) = part.as_str() {
                        Some(text.to_string())
                    } else {
                        part.get("text").and_then(Value::as_str).map(str::to_string)
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            if !text.is_empty() {
                return text;
            }
        }
    }
    result.to_string()
}

pub(crate) fn extract_error_message(value: &Value) -> Option<String> {
    value
        .get("errorMessage")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .or_else(|| {
            value
                .get("message")
                .and_then(|message| message.get("errorMessage"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string)
        })
}

pub(crate) fn extract_assistant_text(message: &Value) -> Option<String> {
    if message.get("role").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let content = message.get("content")?;
    let text = match content {
        Value::String(value) => value.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| match part {
                Value::String(value) => Some(value.as_str()),
                Value::Object(object) => {
                    let kind = object.get("type").and_then(Value::as_str).unwrap_or("");
                    matches!(kind, "text" | "output_text")
                        .then(|| object.get("text").and_then(Value::as_str).unwrap_or(""))
                }
                _ => None,
            })
            .collect::<String>(),
        _ => String::new(),
    };
    (!text.trim().is_empty()).then_some(text)
}

/// Parse one NDJSON line from `pi --print --mode json`.
pub(crate) fn parse_pi_stream_line(value: &Value) -> PiStreamLine {
    let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
    match event_type {
        "session" => {
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string);
            match id {
                Some(session_id) => PiStreamLine::SessionId(session_id),
                None => PiStreamLine::Other,
            }
        }
        "message_update" => {
            let update = value.get("assistantMessageEvent");
            let update_type = update
                .and_then(|u| u.get("type"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let delta = update
                .and_then(|u| u.get("delta"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if delta.is_empty() {
                return PiStreamLine::Other;
            }
            match update_type {
                "text_delta" => PiStreamLine::TextDelta(delta.to_string()),
                "thinking_delta" => PiStreamLine::ThinkingDelta(delta.to_string()),
                _ => PiStreamLine::Other,
            }
        }
        "tool_execution_start" => {
            let tool_id = value
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let tool_name = value
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            let args = value.get("args").cloned();
            if tool_id.is_empty() {
                PiStreamLine::Other
            } else {
                PiStreamLine::ToolStart {
                    tool_id,
                    tool_name,
                    args,
                }
            }
        }
        "tool_execution_end" => {
            let tool_id = value
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if tool_id.is_empty() {
                return PiStreamLine::Other;
            }
            let content = extract_tool_result_text(value.get("result"));
            let is_error = value
                .get("isError")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            PiStreamLine::ToolEnd {
                tool_id,
                content,
                is_error,
            }
        }
        "message_end" | "message_start" => {
            if let Some(error) = extract_error_message(value) {
                return PiStreamLine::AssistantError(error);
            }
            let message = value.get("message");
            let role = message
                .and_then(|m| m.get("role"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if role == "custom" {
                return parse_pi_custom_message_line(event_type, message);
            }
            if role == "assistant" {
                if event_type == "message_end" {
                    if let Some(text) = message.and_then(extract_assistant_text) {
                        return PiStreamLine::AssistantSnapshot(text);
                    }
                }
                if let Some(usage) = message.and_then(|m| m.get("usage")) {
                    return PiStreamLine::Usage(usage.clone());
                }
            }
            PiStreamLine::Other
        }
        "turn_start" => PiStreamLine::TurnStart,
        "turn_end" => {
            if let Some(error) = extract_error_message(value) {
                PiStreamLine::AssistantError(error)
            } else {
                PiStreamLine::TurnEnd
            }
        }
        "agent_end" => extract_error_message(value)
            .map(PiStreamLine::AssistantError)
            .unwrap_or(PiStreamLine::Other),
        _ => PiStreamLine::Other,
    }
}
