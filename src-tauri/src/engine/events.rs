//! Unified event types for engine streaming output
//!
//! All engines emit events that are converted to this unified format
//! before being sent to the frontend.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::backend::events::AppServerEvent;

use super::EngineType;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextToolUsage {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,
    pub tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextCategoryUsage {
    pub name: String,
    pub tokens: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<f64>,
}

/// Unified engine event for frontend consumption
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EngineEvent {
    /// Session/conversation started
    #[serde(rename = "session:started")]
    SessionStarted {
        workspace_id: String,
        session_id: String,
        engine: EngineType,
        #[serde(skip_serializing_if = "Option::is_none")]
        turn_id: Option<String>,
    },

    /// Turn/response started
    #[serde(rename = "turn:started")]
    TurnStarted {
        workspace_id: String,
        turn_id: String,
    },

    /// Text content delta (streaming)
    #[serde(rename = "text:delta")]
    TextDelta { workspace_id: String, text: String },

    /// Reasoning/thinking content (for models that expose it)
    #[serde(rename = "reasoning:delta")]
    ReasoningDelta { workspace_id: String, text: String },

    /// Tool use started
    #[serde(rename = "tool:started")]
    ToolStarted {
        workspace_id: String,
        tool_id: String,
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
    },

    /// Tool use completed
    #[serde(rename = "tool:completed")]
    ToolCompleted {
        workspace_id: String,
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    /// Tool input updated (streaming arguments)
    #[serde(rename = "tool:inputUpdated")]
    ToolInputUpdated {
        workspace_id: String,
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
    },

    /// Tool output updated while the tool is still running
    #[serde(rename = "tool:outputDelta")]
    ToolOutputDelta {
        workspace_id: String,
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
        delta: String,
    },

    /// Background task card started (pi `bg_*` / `fusion_*` tool call from the
    /// pi-background-tasks extension). Replaces the generic ToolStarted card so
    /// the frontend renders a live task card instead.
    #[serde(rename = "backgroundTask:started")]
    BackgroundTaskStarted {
        workspace_id: String,
        tool_id: String,
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
    },

    /// Background task state update: launch receipt snapshot (source
    /// "receipt") or terminal `<background-task-notification>` wakeup (source
    /// "notification") from the pi-background-tasks extension.
    #[serde(rename = "backgroundTask:updated")]
    BackgroundTaskUpdated {
        workspace_id: String,
        /// Originating tool call id (receipt path only; the notification path
        /// correlates by `task.id` instead).
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_id: Option<String>,
        /// Canonical snapshot from the extension (`result.details.task` /
        /// notification `details`, or the text-envelope fallback fields).
        task: Value,
        /// "receipt" | "notification"
        source: String,
    },

    /// Approval request from engine
    #[serde(rename = "approval:request")]
    ApprovalRequest {
        workspace_id: String,
        request_id: Value,
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },

    /// User input request (AskUserQuestion tool)
    #[serde(rename = "userInput:request")]
    RequestUserInput {
        workspace_id: String,
        request_id: Value,
        questions: Value,
        /// When true, this is a *removal* signal (e.g. backend timeout): the
        /// frontend drops the pending dialog instead of showing it. Normal asks
        /// leave this false.
        #[serde(default)]
        completed: bool,
    },

    /// Turn/response completed
    #[serde(rename = "turn:completed")]
    TurnCompleted {
        workspace_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
    },

    /// Turn/response error
    #[serde(rename = "turn:error")]
    TurnError {
        workspace_id: String,
        error: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },

    /// Session ended
    #[serde(rename = "session:ended")]
    SessionEnded {
        workspace_id: String,
        session_id: String,
    },

    /// Usage/token information
    #[serde(rename = "usage:update")]
    UsageUpdate {
        workspace_id: String,
        input_tokens: Option<i64>,
        output_tokens: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cached_tokens: Option<i64>,
        /// Model context window size (from Claude statusline/hooks)
        #[serde(skip_serializing_if = "Option::is_none")]
        model_context_window: Option<i64>,
        /// Runtime-reported current context-window used tokens when available.
        #[serde(skip_serializing_if = "Option::is_none")]
        context_used_tokens: Option<i64>,
        /// Context usage source, for example `live` or `estimated`.
        #[serde(skip_serializing_if = "Option::is_none")]
        context_usage_source: Option<String>,
        /// Context usage freshness exposed to UI.
        #[serde(skip_serializing_if = "Option::is_none")]
        context_usage_freshness: Option<String>,
        /// Runtime-reported used percentage when available.
        #[serde(skip_serializing_if = "Option::is_none")]
        context_used_percent: Option<f64>,
        /// Runtime-reported remaining percentage when available.
        #[serde(skip_serializing_if = "Option::is_none")]
        context_remaining_percent: Option<f64>,
        /// Top context contributors from Claude `/context`, currently MCP tools.
        #[serde(skip_serializing_if = "Option::is_none")]
        context_tool_usages: Option<Vec<ContextToolUsage>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        context_tool_usages_truncated: Option<bool>,
        /// Estimated usage by category from Claude `/context`.
        #[serde(skip_serializing_if = "Option::is_none")]
        context_category_usages: Option<Vec<ContextCategoryUsage>>,
    },

    /// Processing heartbeat while waiting for first visible output
    #[serde(rename = "processing:heartbeat")]
    ProcessingHeartbeat { workspace_id: String, pulse: u64 },

    /// Raw engine-specific event (passthrough)
    #[serde(rename = "raw")]
    Raw {
        workspace_id: String,
        engine: EngineType,
        data: Value,
    },
}

impl EngineEvent {
    /// Get the workspace ID for this event
    pub fn workspace_id(&self) -> &str {
        match self {
            EngineEvent::SessionStarted { workspace_id, .. } => workspace_id,
            EngineEvent::TurnStarted { workspace_id, .. } => workspace_id,
            EngineEvent::TextDelta { workspace_id, .. } => workspace_id,
            EngineEvent::ReasoningDelta { workspace_id, .. } => workspace_id,
            EngineEvent::ToolStarted { workspace_id, .. } => workspace_id,
            EngineEvent::ToolCompleted { workspace_id, .. } => workspace_id,
            EngineEvent::ToolInputUpdated { workspace_id, .. } => workspace_id,
            EngineEvent::ToolOutputDelta { workspace_id, .. } => workspace_id,
            EngineEvent::BackgroundTaskStarted { workspace_id, .. } => workspace_id,
            EngineEvent::BackgroundTaskUpdated { workspace_id, .. } => workspace_id,
            EngineEvent::ApprovalRequest { workspace_id, .. } => workspace_id,
            EngineEvent::RequestUserInput { workspace_id, .. } => workspace_id,
            EngineEvent::TurnCompleted { workspace_id, .. } => workspace_id,
            EngineEvent::TurnError { workspace_id, .. } => workspace_id,
            EngineEvent::SessionEnded { workspace_id, .. } => workspace_id,
            EngineEvent::UsageUpdate { workspace_id, .. } => workspace_id,
            EngineEvent::ProcessingHeartbeat { workspace_id, .. } => workspace_id,
            EngineEvent::Raw { workspace_id, .. } => workspace_id,
        }
    }

    /// Check if this is a terminal event (turn completed or error)
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            EngineEvent::TurnCompleted { .. } | EngineEvent::TurnError { .. }
        )
    }
}

pub fn resolve_claude_realtime_item_id<'a>(
    event: &EngineEvent,
    assistant_item_id: &'a str,
    reasoning_item_id: &'a str,
) -> &'a str {
    match event {
        EngineEvent::ReasoningDelta { .. } => reasoning_item_id,
        _ => assistant_item_id,
    }
}

#[derive(Clone, Copy)]
enum ToolItemKind {
    MpcToolCall,
    CommandExecution,
    FileChange,
}

impl ToolItemKind {
    fn item_type(self) -> &'static str {
        match self {
            ToolItemKind::MpcToolCall => "mcpToolCall",
            ToolItemKind::CommandExecution => "commandExecution",
            ToolItemKind::FileChange => "fileChange",
        }
    }
}

fn first_non_empty_object_string<'a>(
    map: &'a serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<&'a str> {
    keys.iter().find_map(|key| {
        map.get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    })
}

fn parse_tool_input_object(input: Option<&Value>) -> Option<serde_json::Map<String, Value>> {
    let value = input?;
    match value {
        Value::Object(map) => Some(map.clone()),
        Value::String(raw) => serde_json::from_str::<Value>(raw)
            .ok()
            .and_then(|parsed| parsed.as_object().cloned()),
        _ => None,
    }
}

fn input_looks_like_command(input: Option<&Value>) -> bool {
    let Some(map) = parse_tool_input_object(input) else {
        return false;
    };
    first_non_empty_object_string(&map, &["command", "cmd", "script", "shell_command", "bash"])
        .is_some()
}

fn compact_tool_name(tool_name: &str) -> String {
    tool_name
        .trim()
        .to_ascii_lowercase()
        .replace(['_', '-', ' '], "")
}

/// Checklist tools (`todo_write` / `TodoWrite` / `mcp__x__TodoWrite`) contain
/// "write" but MUST stay generic tool calls so Composer can read `{ todos }`.
fn is_checklist_tool_name(tool_name: &str) -> bool {
    let compact = compact_tool_name(tool_name);
    compact == "todowrite" || compact.ends_with("todowrite")
}

fn resolve_tool_item_kind(tool_name: Option<&str>, input: Option<&Value>) -> ToolItemKind {
    let lower = tool_name.unwrap_or_default().trim().to_ascii_lowercase();
    // DSH `tool/result` / later `tool-call-delta` chunks often omit `name`.
    // Classify from structured args so bash is not rewritten as mcpToolCall +
    // server="agent" (which the canvas then renders as Agent / 子代理).
    if lower.is_empty() {
        if input_looks_like_command(input) {
            return ToolItemKind::CommandExecution;
        }
        return ToolItemKind::MpcToolCall;
    }
    if is_checklist_tool_name(&lower) {
        return ToolItemKind::MpcToolCall;
    }
    // Command-like tools can contain "write" in their name (for example write_stdin).
    // Classify these first to avoid misreporting terminal interaction as file changes.
    if lower.contains("exec")
        || lower.contains("bash")
        || lower.contains("shell")
        || lower.contains("terminal")
        || lower.contains("command")
        || lower.contains("stdin")
        || lower == "run"
        || lower.starts_with("run_")
    {
        return ToolItemKind::CommandExecution;
    }
    // Delete/remove file tools → fileChange (deleted) for canvas file-edit scene.
    if lower == "delete"
        || lower == "delete_file"
        || lower == "remove_file"
        || lower == "rm"
        || lower.contains("delete_file")
        || lower.contains("remove_file")
    {
        return ToolItemKind::FileChange;
    }
    // Grok/Kimi/OpenCode/Claude write/edit variants → fileChange for fileEdit scene.
    if lower.contains("apply")
        || lower.contains("patch")
        || lower.contains("write")
        || lower.contains("edit")
        || lower.contains("search_replace")
        || lower.contains("replace_string")
        || lower.starts_with("replace-")
        || lower.contains("replace-")
        || lower == "create_file"
        || lower == "str_replace"
        || lower == "multiedit"
        || lower == "multi_edit"
    {
        return ToolItemKind::FileChange;
    }
    // Read/list/search/web stay mcpToolCall with tool=name for FE specialized blocks.
    ToolItemKind::MpcToolCall
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClaudeCompactionSignal {
    Compacting,
    CompactBoundary,
    CompactionFailed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClaudePermissionSignal {
    RequestUserInputBlocked,
    FileChangeBlocked,
    CommandExecutionBlocked,
}

fn normalize_claude_signal_token(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(['-', ' '], "_")
}

fn detect_claude_compaction_signal(data: &Value) -> Option<ClaudeCompactionSignal> {
    let candidates = [
        "subtype",
        "subType",
        "event",
        "event_type",
        "eventType",
        "name",
        "kind",
        "status",
        "phase",
        "state",
        "type",
    ];
    for key in candidates {
        let Some(raw) = data.get(key).and_then(|value| value.as_str()) else {
            continue;
        };
        let normalized = normalize_claude_signal_token(raw);
        if normalized.contains("compaction_failed")
            || normalized.contains("compact_failed")
            || normalized.contains("compactfailure")
        {
            return Some(ClaudeCompactionSignal::CompactionFailed);
        }
        if normalized.contains("compact_boundary") || normalized.contains("compacted") {
            return Some(ClaudeCompactionSignal::CompactBoundary);
        }
        if normalized.contains("compacting") {
            return Some(ClaudeCompactionSignal::Compacting);
        }
    }
    None
}

fn detect_claude_permission_signal(data: &Value) -> Option<ClaudePermissionSignal> {
    let signal_source = get_value_by_aliases(data, &["source"])
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !signal_source.eq_ignore_ascii_case("claude_permission_denied") {
        return None;
    }

    let blocked_method = get_value_by_aliases(data, &["blockedMethod", "blocked_method"])
        .and_then(Value::as_str)
        .unwrap_or_default();
    if blocked_method == "item/tool/requestUserInput" {
        return Some(ClaudePermissionSignal::RequestUserInputBlocked);
    }
    if blocked_method == "item/fileChange/requestApproval" {
        return Some(ClaudePermissionSignal::FileChangeBlocked);
    }
    if blocked_method == "item/commandExecution/requestApproval" {
        return Some(ClaudePermissionSignal::CommandExecutionBlocked);
    }

    None
}

fn get_value_by_aliases<'a>(data: &'a Value, aliases: &[&str]) -> Option<&'a Value> {
    aliases.iter().find_map(|alias| data.get(*alias))
}

/// Convert an EngineEvent to an AppServerEvent using Codex-compatible JSON-RPC format.
/// This allows the frontend's existing useAppServerEvents hook to handle Claude events
/// identically to Codex events.
#[cfg(test)]
pub fn engine_event_to_app_server_event(
    event: &EngineEvent,
    thread_id: &str,
    item_id: &str,
) -> Option<AppServerEvent> {
    engine_event_to_app_server_event_with_turn_context(event, thread_id, item_id, None)
}

/// Convert an EngineEvent to an AppServerEvent and attach the known foreground
/// turn identity to terminal events. Some engines do not include the
/// app-generated turn id in their raw completed payload, but the forwarder already
/// knows the accepted turn id from the surrounding TurnEvent.
pub fn engine_event_to_app_server_event_with_turn_context(
    event: &EngineEvent,
    thread_id: &str,
    item_id: &str,
    turn_id_context: Option<&str>,
) -> Option<AppServerEvent> {
    let workspace_id = event.workspace_id().to_string();

    fn stringify_value(value: &Value) -> String {
        if let Some(text) = value.as_str() {
            return text.to_string();
        }
        serde_json::to_string_pretty(value).unwrap_or_default()
    }

    let message = match event {
        EngineEvent::SessionStarted {
            session_id,
            engine,
            turn_id,
            ..
        } => json!({
            "method": "thread/started",
            "params": {
                "threadId": thread_id,
                "sessionId": session_id,
                "turnId": turn_id,
                "engine": engine.icon(),
            }
        }),
        EngineEvent::TurnStarted { turn_id, .. } => json!({
            "method": "turn/started",
            "params": {
                "turnId": turn_id,
                "threadId": thread_id,
            }
        }),
        EngineEvent::TextDelta { text, .. } => json!({
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": thread_id,
                "itemId": item_id,
                "delta": text,
            }
        }),
        EngineEvent::ReasoningDelta { text, .. } => json!({
            "method": "item/reasoning/textDelta",
            "params": {
                "threadId": thread_id,
                "itemId": item_id,
                "delta": text,
            }
        }),
        EngineEvent::ToolStarted {
            tool_id,
            tool_name,
            input,
            ..
        } => {
            let item_kind = resolve_tool_item_kind(Some(tool_name.as_str()), input.as_ref());
            let item = match item_kind {
                ToolItemKind::CommandExecution => json!({
                    "id": tool_id,
                    "type": item_kind.item_type(),
                    "title": tool_name,
                    "tool": tool_name,
                    "input": input,
                    "arguments": input,
                    "status": "started",
                }),
                ToolItemKind::FileChange => json!({
                    "id": tool_id,
                    "type": item_kind.item_type(),
                    // Keep tool name so FE edit/read polish + scene grouping stay name-aware.
                    "title": tool_name,
                    "tool": tool_name,
                    "input": input,
                    "arguments": input,
                    "status": "started",
                }),
                ToolItemKind::MpcToolCall => json!({
                    "id": tool_id,
                    // Prefer engine-neutral server label so FE titles are not Claude-hardcoded.
                    "type": item_kind.item_type(),
                    "server": "agent",
                    "tool": tool_name,
                    "title": tool_name,
                    "arguments": input,
                    "status": "started",
                }),
            };
            json!({
                "method": "item/started",
                "params": {
                    "threadId": thread_id,
                    "item": item,
                }
            })
        }
        EngineEvent::ToolCompleted {
            tool_id,
            tool_name,
            output,
            error,
            ..
        } => {
            let embedded_args = output
                .as_ref()
                .and_then(|value| value.get("_input"))
                .cloned();
            let normalized_output = output
                .as_ref()
                .and_then(|value| value.get("_output"))
                .cloned()
                .or_else(|| output.clone());
            let normalized_output_text = normalized_output.as_ref().map(stringify_value);
            let item_kind = resolve_tool_item_kind(
                tool_name.as_deref(),
                embedded_args.as_ref().or(output.as_ref()),
            );
            // DSH `tool/result` often omits `name`. Never fall back to the provider
            // call id (`Call-<uuid>|fc_...`) — that string is an identity, not a title.
            // Omit title/tool so the frontend keeps the name from `tool/call`.
            let resolved_title = tool_name
                .as_ref()
                .map(|name| name.trim())
                .filter(|name| !name.is_empty())
                .map(str::to_string);
            let mut item = match item_kind {
                ToolItemKind::CommandExecution => json!({
                    "id": tool_id,
                    "type": item_kind.item_type(),
                    "input": embedded_args,
                    "arguments": embedded_args,
                    "aggregatedOutput": normalized_output_text.clone(),
                    "output": normalized_output_text.clone(),
                    "error": error.clone(),
                    "status": if error.is_some() { "failed" } else { "completed" },
                }),
                ToolItemKind::FileChange => json!({
                    "id": tool_id,
                    "type": item_kind.item_type(),
                    "input": embedded_args,
                    "arguments": embedded_args,
                    "output": normalized_output_text.clone(),
                    "error": error.clone(),
                    "status": if error.is_some() { "failed" } else { "completed" },
                }),
                ToolItemKind::MpcToolCall => {
                    json!({
                        "id": tool_id,
                        "type": item_kind.item_type(),
                        "server": "agent",
                        "arguments": embedded_args,
                        "result": normalized_output_text.clone(),
                        "error": error.clone(),
                        "status": if error.is_some() { "failed" } else { "completed" },
                    })
                }
            };
            if let Some(title) = resolved_title {
                item["title"] = Value::String(title.clone());
                item["tool"] = Value::String(title);
            }
            json!({
                "method": "item/completed",
                "params": {
                    "threadId": thread_id,
                    "item": item,
                    "output": normalized_output_text,
                    "error": error,
                }
            })
        }
        EngineEvent::ToolInputUpdated {
            tool_id,
            tool_name,
            input,
            ..
        } => {
            let item_kind = resolve_tool_item_kind(tool_name.as_deref(), input.as_ref());
            let item = match item_kind {
                ToolItemKind::CommandExecution | ToolItemKind::FileChange => json!({
                    "id": tool_id,
                    "type": item_kind.item_type(),
                    "input": input,
                    "arguments": input,
                    "status": "started",
                }),
                ToolItemKind::MpcToolCall => {
                    let mut item = json!({
                        "id": tool_id,
                        "type": item_kind.item_type(),
                        "server": "agent",
                        "arguments": input,
                        "status": "started",
                    });
                    if let Some(name) = tool_name
                        .as_ref()
                        .map(|value| value.trim())
                        .filter(|value| !value.is_empty())
                    {
                        item["tool"] = Value::String(name.to_string());
                        item["title"] = Value::String(name.to_string());
                    }
                    item
                }
            };
            json!({
                "method": "item/updated",
                "params": {
                    "threadId": thread_id,
                    "item": item,
                }
            })
        }
        EngineEvent::ToolOutputDelta {
            tool_id,
            tool_name,
            delta,
            ..
        } => {
            let method = match resolve_tool_item_kind(tool_name.as_deref(), None) {
                ToolItemKind::FileChange => "item/fileChange/outputDelta",
                _ => "item/commandExecution/outputDelta",
            };
            let tool_tail_marker = delta.len() > 4096;
            json!({
                "method": method,
                "params": {
                    "threadId": thread_id,
                    "itemId": tool_id,
                    "delta": delta,
                    "tool_tail_marker": tool_tail_marker,
                }
            })
        }
        EngineEvent::TurnCompleted { result, .. } => {
            let mut params = serde_json::Map::new();
            params.insert("threadId".to_string(), Value::String(thread_id.to_string()));
            if let Some(turn_id) = turn_id_context
                .map(str::trim)
                .filter(|turn_id| !turn_id.is_empty())
            {
                params.insert("turnId".to_string(), Value::String(turn_id.to_string()));
            }
            params.insert("result".to_string(), result.clone().unwrap_or(Value::Null));
            params.insert("assistantFinalBoundary".to_string(), Value::Bool(true));
            json!({
                "method": "turn/completed",
                "params": Value::Object(params),
            })
        }
        EngineEvent::TurnError { error, code, .. } => json!({
            "method": "turn/error",
            "params": {
                "threadId": thread_id,
                "error": error,
                "code": code,
            }
        }),
        EngineEvent::UsageUpdate {
            input_tokens,
            output_tokens,
            cached_tokens,
            model_context_window,
            context_used_tokens,
            context_usage_source,
            context_usage_freshness,
            context_used_percent,
            context_remaining_percent,
            context_tool_usages,
            context_tool_usages_truncated,
            context_category_usages,
            ..
        } => json!({
            "method": "thread/tokenUsage/updated",
            "params": {
                "threadId": thread_id,
                "tokenUsage": {
                    "total": {
                        "inputTokens": input_tokens,
                        "outputTokens": output_tokens,
                        "cachedInputTokens": cached_tokens,
                        "totalTokens": input_tokens.unwrap_or(0) + output_tokens.unwrap_or(0),
                    },
                    "last": {
                        "inputTokens": input_tokens,
                        "outputTokens": output_tokens,
                        "cachedInputTokens": cached_tokens,
                        "totalTokens": input_tokens.unwrap_or(0) + output_tokens.unwrap_or(0),
                    },
                    "modelContextWindow": model_context_window,
                    "contextUsedTokens": context_used_tokens,
                    "contextUsageSource": context_usage_source,
                    "contextUsageFreshness": context_usage_freshness,
                    "contextUsedPercent": context_used_percent,
                    "contextRemainingPercent": context_remaining_percent,
                    "contextToolUsages": context_tool_usages,
                    "contextToolUsagesTruncated": context_tool_usages_truncated,
                    "contextCategoryUsages": context_category_usages,
                }
            }
        }),
        EngineEvent::ProcessingHeartbeat { pulse, .. } => json!({
            "method": "processing/heartbeat",
            "params": {
                "threadId": thread_id,
                "pulse": pulse,
            }
        }),
        EngineEvent::ApprovalRequest {
            request_id,
            tool_name,
            input,
            message,
            ..
        } => {
            let tool_name_lower = tool_name.to_ascii_lowercase();
            let method = if tool_name_lower == "directorygrant"
                || tool_name_lower.contains("directory_grant")
                || tool_name_lower.contains("directorygrant")
            {
                "item/directoryGrant/requestApproval"
            } else if is_checklist_tool_name(&tool_name_lower) {
                "approval/request"
            } else if tool_name_lower.contains("apply")
                || tool_name_lower.contains("patch")
                || tool_name_lower.contains("write")
                || tool_name_lower.contains("edit")
            {
                "item/fileChange/requestApproval"
            } else if tool_name_lower.contains("exec")
                || tool_name_lower.contains("bash")
                || tool_name_lower.contains("command")
            {
                "item/commandExecution/requestApproval"
            } else {
                "approval/request"
            };

            let mut merged_params = if let Some(Value::Object(map)) = input.clone() {
                map
            } else {
                serde_json::Map::new()
            };
            merged_params.insert("threadId".to_string(), Value::String(thread_id.to_string()));
            merged_params.insert("turnId".to_string(), Value::String(item_id.to_string()));
            merged_params.insert("itemId".to_string(), Value::String(item_id.to_string()));
            merged_params.insert("toolName".to_string(), Value::String(tool_name.clone()));
            if let Some(message_text) = message.clone() {
                merged_params.insert("message".to_string(), Value::String(message_text));
            }
            if let Some(raw_input) = input.clone() {
                merged_params.insert("input".to_string(), raw_input);
            }

            json!({
                "method": method,
                "params": Value::Object(merged_params),
                "id": request_id,
            })
        }
        EngineEvent::RequestUserInput {
            request_id,
            questions,
            completed,
            ..
        } => {
            // Anchor the ask card to its own request, not the assistant message
            // head. resolve_claude_realtime_item_id() returns assistant_item_id
            // for RequestUserInput, so `itemId: item_id` pinned the card to the
            // top of the turn (it rendered right after the assistant message's
            // first block, then got buried as the turn streamed on). A unique,
            // non-matching itemId makes the frontend fall back to its default
            // tail placement, so the card renders at the bottom of the turn near
            // the composer; it also gives the settled ask its own item id instead
            // of reusing the assistant message item.
            //
            // turnId MUST be the runtime turn identity (turn_id_context), not the
            // assistant item id. Shared Session control-owner resolution compares
            // params.turnId to sharedOwner.runtimeTurnId and fail-closes on
            // mismatch — using assistant item id silently drops AskUserQuestion
            // dialogs in Shared while the MCP tool keeps spinning.
            let ask_item_id = format!("askuserquestion-{}", stringify_value(request_id));
            let turn_id = turn_id_context
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(item_id);
            json!({
                "method": "item/tool/requestUserInput",
                "params": {
                    "threadId": thread_id,
                    "turnId": turn_id,
                    "itemId": ask_item_id,
                    "questions": questions,
                    "completed": completed,
                },
                "id": request_id,
            })
        }
        EngineEvent::Raw { data, engine, .. } => {
            if matches!(engine, EngineType::Claude) {
                if let Some(signal) = detect_claude_permission_signal(data) {
                    match signal {
                        ClaudePermissionSignal::RequestUserInputBlocked
                        | ClaudePermissionSignal::FileChangeBlocked
                        | ClaudePermissionSignal::CommandExecutionBlocked => {
                            let blocked_method =
                                get_value_by_aliases(data, &["blockedMethod", "blocked_method"])
                                    .and_then(Value::as_str)
                                    .unwrap_or("item/tool/requestUserInput");
                            let effective_mode =
                                get_value_by_aliases(data, &["effectiveMode", "effective_mode"])
                                    .and_then(Value::as_str)
                                    .unwrap_or("code");
                            let reason_code =
                                get_value_by_aliases(data, &["reasonCode", "reason_code"])
                                    .and_then(Value::as_str)
                                    .unwrap_or("claude_permission_denied");
                            let reason = get_value_by_aliases(
                                data,
                                &["reason", "message", "rawError", "raw_error"],
                            )
                            .and_then(|value| {
                                if let Some(text) = value.as_str() {
                                    return Some(text.to_string());
                                }
                                if value.is_object() || value.is_array() {
                                    return serde_json::to_string(value).ok();
                                }
                                None
                            })
                            .unwrap_or_else(|| {
                                "Claude denied the interactive tool before GUI approval could start."
                                    .to_string()
                            });
                            let suggestion = get_value_by_aliases(data, &["suggestion"])
                                .and_then(Value::as_str)
                                .unwrap_or(
                                    "Use Plan mode for this Claude workflow until the approval bridge is implemented.",
                                );
                            let request_id =
                                get_value_by_aliases(data, &["requestId", "request_id"])
                                    .cloned()
                                    .unwrap_or_else(|| Value::String(item_id.to_string()));
                            json!({
                                "method": "collaboration/modeBlocked",
                                "params": {
                                    "threadId": thread_id,
                                    "thread_id": thread_id,
                                    "blockedMethod": blocked_method,
                                    "blocked_method": blocked_method,
                                    "effectiveMode": effective_mode,
                                    "effective_mode": effective_mode,
                                    "reasonCode": reason_code,
                                    "reason_code": reason_code,
                                    "reason": reason,
                                    "suggestion": suggestion,
                                    "requestId": request_id,
                                    "request_id": request_id,
                                }
                            })
                        }
                    }
                } else if let Some(signal) = detect_claude_compaction_signal(data) {
                    match signal {
                        ClaudeCompactionSignal::Compacting => {
                            let mut params = serde_json::Map::new();
                            params.insert(
                                "threadId".to_string(),
                                Value::String(thread_id.to_string()),
                            );
                            if let Some(value) =
                                get_value_by_aliases(data, &["usagePercent", "usage_percent"])
                            {
                                params.insert("usagePercent".to_string(), value.clone());
                            }
                            if let Some(value) = get_value_by_aliases(
                                data,
                                &["thresholdPercent", "threshold_percent"],
                            ) {
                                params.insert("thresholdPercent".to_string(), value.clone());
                            }
                            if let Some(value) =
                                get_value_by_aliases(data, &["targetPercent", "target_percent"])
                            {
                                params.insert("targetPercent".to_string(), value.clone());
                            }
                            json!({
                                "method": "thread/compacting",
                                "params": Value::Object(params),
                            })
                        }
                        ClaudeCompactionSignal::CompactBoundary => {
                            let turn_id_value = get_value_by_aliases(
                                data,
                                &["turnId", "turn_id", "requestId", "request_id"],
                            )
                            .and_then(|value| value.as_str())
                            .filter(|value| !value.trim().is_empty())
                            .unwrap_or(item_id)
                            .to_string();
                            json!({
                                "method": "thread/compacted",
                                "params": {
                                    "threadId": thread_id,
                                    "turnId": turn_id_value,
                                },
                            })
                        }
                        ClaudeCompactionSignal::CompactionFailed => {
                            let reason =
                                get_value_by_aliases(data, &["reason", "message", "error"])
                                    .and_then(|value| {
                                        if let Some(text) = value.as_str() {
                                            return Some(text.to_string());
                                        }
                                        if value.is_object() || value.is_array() {
                                            return serde_json::to_string(value).ok();
                                        }
                                        None
                                    })
                                    .unwrap_or_else(|| {
                                        "Automatic context compaction failed".to_string()
                                    });
                            json!({
                                "method": "thread/compactionFailed",
                                "params": {
                                    "threadId": thread_id,
                                    "reason": reason,
                                },
                            })
                        }
                    }
                } else {
                    let mut params = match data {
                        Value::Object(map) => map.clone(),
                        _ => {
                            let mut map = serde_json::Map::new();
                            map.insert("data".to_string(), data.clone());
                            map
                        }
                    };
                    params
                        .entry("threadId".to_string())
                        .or_insert_with(|| Value::String(thread_id.to_string()));
                    json!({
                        "method": format!("{}/raw", engine.icon()),
                        "params": Value::Object(params),
                    })
                }
            } else if engine.is_pi_family() {
                // pi 族 RPC compaction events → canonical thread/compaction methods
                // (same surface Claude uses, so curtain rendering is shared).
                let kind = data.get("kind").and_then(Value::as_str).unwrap_or("");
                let payload = data.get("payload").cloned().unwrap_or(Value::Null);
                match kind {
                    "compaction_start" => {
                        let reason = payload
                            .get("reason")
                            .and_then(Value::as_str)
                            .unwrap_or("manual")
                            .to_string();
                        json!({
                            "method": "thread/compacting",
                            "params": {
                                "threadId": thread_id,
                                "reason": reason,
                            }
                        })
                    }
                    "compaction_end" => {
                        let aborted = payload
                            .get("aborted")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                        let error_message = payload
                            .get("errorMessage")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        if aborted || payload.get("result").is_none() || error_message.is_some() {
                            json!({
                                "method": "thread/compactionFailed",
                                "params": {
                                    "threadId": thread_id,
                                    "reason": error_message.unwrap_or_else(|| {
                                        if aborted {
                                            "Compaction aborted".to_string()
                                        } else {
                                            "Compaction failed".to_string()
                                        }
                                    }),
                                }
                            })
                        } else {
                            let result = payload.get("result").cloned().unwrap_or(Value::Null);
                            json!({
                                "method": "thread/compacted",
                                "params": {
                                    "threadId": thread_id,
                                    // 透传 pi 的触发原因（threshold/overflow/manual）供留痕区分
                                    // 自动/手动；缺失时置 null，不伪造取值。
                                    "reason": payload
                                        .get("reason")
                                        .cloned()
                                        .unwrap_or(Value::Null),
                                    "tokensBefore": result.get("tokensBefore").cloned().unwrap_or(Value::Null),
                                    "estimatedTokensAfter": result.get("estimatedTokensAfter").cloned().unwrap_or(Value::Null),
                                    "firstKeptEntryId": result.get("firstKeptEntryId").cloned().unwrap_or(Value::Null),
                                }
                            })
                        }
                    }
                    _ => {
                        let mut params = match data {
                            Value::Object(map) => map.clone(),
                            _ => {
                                let mut map = serde_json::Map::new();
                                map.insert("data".to_string(), data.clone());
                                map
                            }
                        };
                        params
                            .entry("threadId".to_string())
                            .or_insert_with(|| Value::String(thread_id.to_string()));
                        json!({
                            "method": format!("{}/raw", engine.icon()),
                            "params": Value::Object(params),
                        })
                    }
                }
            } else {
                // pi 族：agent_settled 生命周期标记 → thread/runSettled 信号。
                // pi 的 run 含多个原生 turn，每 turn 一次 turn/completed 会让
                // 完成音等「整轮结束」语义连响；整轮粒度的消费者监听本信号。
                if engine.is_pi_family()
                    && data.get("kind").and_then(Value::as_str) == Some("agent_settled")
                {
                    return Some(AppServerEvent {
                        workspace_id,
                        message: json!({
                            "method": "thread/runSettled",
                            "params": {
                                "threadId": thread_id,
                                "turnId": turn_id_context.unwrap_or(""),
                            }
                        }),
                    });
                }
                let mut params = match data {
                    Value::Object(map) => map.clone(),
                    _ => {
                        let mut map = serde_json::Map::new();
                        map.insert("data".to_string(), data.clone());
                        map
                    }
                };
                params
                    .entry("threadId".to_string())
                    .or_insert_with(|| Value::String(thread_id.to_string()));
                json!({
                    "method": format!("{}/raw", engine.icon()),
                    "params": Value::Object(params),
                })
            }
        }
        EngineEvent::BackgroundTaskStarted {
            tool_id,
            tool_name,
            input,
            ..
        } => json!({
            "method": "item/started",
            "params": {
                "threadId": thread_id,
                "item": {
                    "id": tool_id,
                    "type": "backgroundTask",
                    "tool": tool_name,
                    "title": tool_name,
                    "input": input,
                    "arguments": input,
                    "status": "started",
                }
            }
        }),
        EngineEvent::BackgroundTaskUpdated {
            tool_id,
            task,
            source,
            ..
        } => json!({
            "method": "item/backgroundTask/updated",
            "params": {
                "threadId": thread_id,
                "toolId": tool_id,
                "task": task,
                "source": source,
            }
        }),
        _ => return None,
    };

    Some(AppServerEvent {
        workspace_id,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pi_background_task_events_map_to_canonical_items() {
        let started = EngineEvent::BackgroundTaskStarted {
            workspace_id: "ws".to_string(),
            tool_id: "tool-1".to_string(),
            tool_name: "bg_run".to_string(),
            input: Some(json!({"name": "spike-task", "command": "sleep 3"})),
        };
        let event = engine_event_to_app_server_event_with_turn_context(
            &started,
            "pi:s1",
            "item-1",
            Some("turn-1"),
        )
        .expect("backgroundTaskStarted should map");
        assert_eq!(event.message["method"], "item/started");
        assert_eq!(event.message["params"]["item"]["id"], "tool-1");
        assert_eq!(event.message["params"]["item"]["type"], "backgroundTask");
        assert_eq!(event.message["params"]["item"]["tool"], "bg_run");
        assert_eq!(event.message["params"]["item"]["status"], "started");

        let updated = EngineEvent::BackgroundTaskUpdated {
            workspace_id: "ws".to_string(),
            tool_id: Some("tool-1".to_string()),
            task: json!({"id": "b2e2f48ad", "status": "running"}),
            source: "receipt".to_string(),
        };
        let event = engine_event_to_app_server_event_with_turn_context(
            &updated,
            "pi:s1",
            "item-1",
            Some("turn-1"),
        )
        .expect("backgroundTaskUpdated should map");
        assert_eq!(event.message["method"], "item/backgroundTask/updated");
        assert_eq!(event.message["params"]["toolId"], "tool-1");
        assert_eq!(event.message["params"]["task"]["id"], "b2e2f48ad");
        assert_eq!(event.message["params"]["source"], "receipt");

        // 通知路径：无 tool_id，按 task.id 关联。
        let notified = EngineEvent::BackgroundTaskUpdated {
            workspace_id: "ws".to_string(),
            tool_id: None,
            task: json!({"id": "b2e2f48ad", "status": "completed", "exitCode": 0}),
            source: "notification".to_string(),
        };
        let event = engine_event_to_app_server_event_with_turn_context(
            &notified,
            "pi:s1",
            "item-1",
            Some("turn-1"),
        )
        .expect("notification update should map");
        assert_eq!(event.message["method"], "item/backgroundTask/updated");
        assert!(event.message["params"]["toolId"].is_null());
        assert_eq!(event.message["params"]["task"]["exitCode"], 0);
    }

    #[test]
    fn pi_rpc_compaction_events_map_to_canonical_thread_methods() {
        let start = EngineEvent::Raw {
            workspace_id: "ws".to_string(),
            engine: EngineType::Pi,
            data: json!({
                "source": "pi_rpc",
                "kind": "compaction_start",
                "payload": {"type": "compaction_start", "reason": "manual"},
            }),
        };
        let event = engine_event_to_app_server_event_with_turn_context(
            &start,
            "pi:s1",
            "item-1",
            Some("turn-1"),
        )
        .expect("compaction_start should map");
        assert_eq!(event.message["method"], "thread/compacting");
        assert_eq!(event.message["params"]["reason"], "manual");

        let end = EngineEvent::Raw {
            workspace_id: "ws".to_string(),
            engine: EngineType::Pi,
            data: json!({
                "source": "pi_rpc",
                "kind": "compaction_end",
                "payload": {
                    "type": "compaction_end",
                    "reason": "manual",
                    "aborted": false,
                    "result": {"tokensBefore": 150000, "estimatedTokensAfter": 32000},
                },
            }),
        };
        let event = engine_event_to_app_server_event_with_turn_context(
            &end,
            "pi:s1",
            "item-1",
            Some("turn-1"),
        )
        .expect("compaction_end should map");
        assert_eq!(event.message["method"], "thread/compacted");
        assert_eq!(event.message["params"]["reason"], "manual");
        assert_eq!(event.message["params"]["tokensBefore"], 150000);
        assert_eq!(event.message["params"]["estimatedTokensAfter"], 32000);

        // auto-compaction（threshold）必须透传 reason，前端留痕才能区分自动/手动
        let auto_end = EngineEvent::Raw {
            workspace_id: "ws".to_string(),
            engine: EngineType::Pi,
            data: json!({
                "source": "pi_rpc",
                "kind": "compaction_end",
                "payload": {
                    "type": "compaction_end",
                    "reason": "threshold",
                    "aborted": false,
                    "result": {"tokensBefore": 236505, "estimatedTokensAfter": 41200},
                },
            }),
        };
        let event = engine_event_to_app_server_event_with_turn_context(
            &auto_end,
            "pi:s1",
            "item-1",
            Some("turn-1"),
        )
        .expect("auto compaction_end should map");
        assert_eq!(event.message["method"], "thread/compacted");
        assert_eq!(event.message["params"]["reason"], "threshold");
        assert_eq!(event.message["params"]["tokensBefore"], 236505);
        assert_eq!(event.message["params"]["estimatedTokensAfter"], 41200);

        // payload 缺 reason 时必须为 null，不伪造 "manual"
        let reasonless_end = EngineEvent::Raw {
            workspace_id: "ws".to_string(),
            engine: EngineType::Pi,
            data: json!({
                "source": "pi_rpc",
                "kind": "compaction_end",
                "payload": {
                    "type": "compaction_end",
                    "aborted": false,
                    "result": {"tokensBefore": 1000, "estimatedTokensAfter": 200},
                },
            }),
        };
        let event = engine_event_to_app_server_event_with_turn_context(
            &reasonless_end,
            "pi:s1",
            "item-1",
            Some("turn-1"),
        )
        .expect("reasonless compaction_end should map");
        assert_eq!(event.message["method"], "thread/compacted");
        assert_eq!(event.message["params"]["reason"], Value::Null);

        let failed = EngineEvent::Raw {
            workspace_id: "ws".to_string(),
            engine: EngineType::Pi,
            data: json!({
                "source": "pi_rpc",
                "kind": "compaction_end",
                "payload": {
                    "type": "compaction_end",
                    "aborted": false,
                    "errorMessage": "quota exceeded",
                    "result": null,
                },
            }),
        };
        let event = engine_event_to_app_server_event_with_turn_context(
            &failed,
            "pi:s1",
            "item-1",
            Some("turn-1"),
        )
        .expect("compaction failure should map");
        assert_eq!(event.message["method"], "thread/compactionFailed");
        assert_eq!(event.message["params"]["reason"], "quota exceeded");
    }

    #[test]
    fn event_serialization() {
        let event = EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "Hello".to_string(),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"text:delta\""));
        // Note: serde's rename_all with internally tagged enums doesn't
        // automatically rename fields within variants
        assert!(json.contains("\"workspace_id\":\"ws-1\""));
    }

    #[test]
    fn event_workspace_id() {
        let event = EngineEvent::TurnStarted {
            workspace_id: "ws-test".to_string(),
            turn_id: "turn-1".to_string(),
        };

        assert_eq!(event.workspace_id(), "ws-test");
    }

    #[test]
    fn event_is_terminal() {
        let completed = EngineEvent::TurnCompleted {
            workspace_id: "ws-1".to_string(),
            result: None,
        };
        assert!(completed.is_terminal());

        let delta = EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "test".to_string(),
        };
        assert!(!delta.is_terminal());
    }

    #[test]
    fn canonical_engine_events_map_to_app_server_contract_methods() {
        let events = vec![
            (
                EngineEvent::TurnStarted {
                    workspace_id: "ws-contract".to_string(),
                    turn_id: "turn-contract-1".to_string(),
                },
                "turn/started",
            ),
            (
                EngineEvent::TextDelta {
                    workspace_id: "ws-contract".to_string(),
                    text: "assistant delta".to_string(),
                },
                "item/agentMessage/delta",
            ),
            (
                EngineEvent::ReasoningDelta {
                    workspace_id: "ws-contract".to_string(),
                    text: "reasoning delta".to_string(),
                },
                "item/reasoning/textDelta",
            ),
            (
                EngineEvent::ToolOutputDelta {
                    workspace_id: "ws-contract".to_string(),
                    tool_id: "tool-contract-1".to_string(),
                    tool_name: Some("exec_command".to_string()),
                    delta: "tool output".to_string(),
                },
                "item/commandExecution/outputDelta",
            ),
            (
                EngineEvent::TurnCompleted {
                    workspace_id: "ws-contract".to_string(),
                    result: None,
                },
                "turn/completed",
            ),
            (
                EngineEvent::TurnError {
                    workspace_id: "ws-contract".to_string(),
                    error: "turn failed".to_string(),
                    code: Some("contract_error".to_string()),
                },
                "turn/error",
            ),
            (
                EngineEvent::UsageUpdate {
                    workspace_id: "ws-contract".to_string(),
                    input_tokens: Some(10),
                    output_tokens: Some(5),
                    cached_tokens: Some(2),
                    model_context_window: Some(200000),
                    context_used_tokens: None,
                    context_usage_source: None,
                    context_usage_freshness: None,
                    context_used_percent: None,
                    context_remaining_percent: None,
                    context_tool_usages: None,
                    context_tool_usages_truncated: None,
                    context_category_usages: None,
                },
                "thread/tokenUsage/updated",
            ),
            (
                EngineEvent::ProcessingHeartbeat {
                    workspace_id: "ws-contract".to_string(),
                    pulse: 7,
                },
                "processing/heartbeat",
            ),
        ];

        for (event, expected_method) in events {
            let mapped =
                engine_event_to_app_server_event(&event, "thread-contract", "item-contract")
                    .expect("canonical event maps to app-server payload");
            assert_eq!(
                mapped.workspace_id, "ws-contract",
                "workspace should remain attached for {expected_method}"
            );
            assert_eq!(
                mapped.message["method"],
                Value::String(expected_method.to_string())
            );
        }
    }

    #[test]
    fn turn_completed_maps_turn_context_to_app_server_payload() {
        let event = EngineEvent::TurnCompleted {
            workspace_id: "ws-1".to_string(),
            result: Some(json!({ "text": "done" })),
        };

        let mapped = engine_event_to_app_server_event_with_turn_context(
            &event,
            "thread-1",
            "assistant-1",
            Some("turn-1"),
        )
        .expect("mapped event");

        assert_eq!(
            mapped.message["method"],
            Value::String("turn/completed".to_string())
        );
        assert_eq!(
            mapped.message["params"]["threadId"],
            Value::String("thread-1".to_string())
        );
        assert_eq!(
            mapped.message["params"]["turnId"],
            Value::String("turn-1".to_string())
        );
        assert_eq!(mapped.message["params"]["result"]["text"], json!("done"));
        assert_eq!(
            mapped.message["params"]["assistantFinalBoundary"],
            json!(true)
        );
    }

    #[test]
    fn turn_completed_without_turn_context_keeps_legacy_shape_without_empty_turn_id() {
        let event = EngineEvent::TurnCompleted {
            workspace_id: "ws-1".to_string(),
            result: None,
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "assistant-1").expect("mapped");

        assert_eq!(
            mapped.message["method"],
            Value::String("turn/completed".to_string())
        );
        assert!(mapped.message["params"].get("turnId").is_none());
        assert_eq!(mapped.message["params"]["result"], Value::Null);
    }

    #[test]
    fn claude_realtime_item_id_uses_reasoning_lane_for_reasoning_events() {
        let reasoning_event = EngineEvent::ReasoningDelta {
            workspace_id: "ws-1".to_string(),
            text: "thinking".to_string(),
        };
        let text_event = EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "answer".to_string(),
        };

        assert_eq!(
            resolve_claude_realtime_item_id(&reasoning_event, "assistant-item", "reasoning-item"),
            "reasoning-item"
        );
        assert_eq!(
            resolve_claude_realtime_item_id(&text_event, "assistant-item", "reasoning-item"),
            "assistant-item"
        );
    }

    #[test]
    fn request_user_input_anchors_item_id_to_its_own_request_not_assistant_head() {
        // Regression: the ask card used to inherit the assistant message item id
        // (resolve_claude_realtime_item_id falls through to assistant_item_id),
        // which anchored it to the top of the turn. It must carry its own
        // request-scoped itemId so the frontend renders it at the conversation
        // tail (the bottom of the turn, near the composer).
        let event = EngineEvent::RequestUserInput {
            workspace_id: "ws-ask".to_string(),
            request_id: json!("ask-req-1"),
            questions: json!([{ "id": "q-0", "header": "Pick", "question": "Which?" }]),
            completed: false,
        };

        let mapped = engine_event_to_app_server_event_with_turn_context(
            &event,
            "thread-1",
            "assistant-item-9",
            Some("runtime-turn-42"),
        )
        .expect("mapped event");

        assert_eq!(
            mapped.message["method"],
            Value::String("item/tool/requestUserInput".to_string())
        );
        // itemId is the ask's own request-scoped id, NOT the assistant message head.
        assert_eq!(
            mapped.message["params"]["itemId"],
            Value::String("askuserquestion-ask-req-1".to_string())
        );
        assert_ne!(
            mapped.message["params"]["itemId"],
            json!("assistant-item-9")
        );
        // turnId must be the runtime turn identity for Shared control-owner match.
        assert_eq!(
            mapped.message["params"]["turnId"],
            Value::String("runtime-turn-42".to_string())
        );

        // Without turn context, fall back to item_id for legacy callers.
        let mapped_legacy =
            engine_event_to_app_server_event(&event, "thread-1", "assistant-item-9")
                .expect("mapped legacy event");
        assert_eq!(
            mapped_legacy.message["params"]["turnId"],
            Value::String("assistant-item-9".to_string())
        );
    }

    #[test]
    fn approval_request_maps_to_app_server_event() {
        let event = EngineEvent::ApprovalRequest {
            workspace_id: "ws-approval".to_string(),
            request_id: json!("req-42"),
            tool_name: "exec".to_string(),
            input: Some(json!({
                "argv": ["git", "status"]
            })),
            message: Some("git status".to_string()),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(mapped.workspace_id, "ws-approval");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/commandExecution/requestApproval".to_string())
        );
        assert_eq!(mapped.message["id"], Value::String("req-42".to_string()));
        assert_eq!(
            mapped.message["params"]["threadId"],
            Value::String("thread-1".to_string())
        );
        assert_eq!(mapped.message["params"]["argv"], json!(["git", "status"]));
    }

    #[test]
    fn directory_grant_approval_maps_to_directory_grant_method() {
        let event = EngineEvent::ApprovalRequest {
            workspace_id: "ws-grant".to_string(),
            request_id: json!("req-grant-1"),
            tool_name: "DirectoryGrant".to_string(),
            input: Some(json!({
                "suggestedRoot": "/Users/me/.claude",
                "grantKind": "directory",
                "defaultScope": "session"
            })),
            message: Some("outside allowed working directories".to_string()),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-g", "item-g").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/directoryGrant/requestApproval".to_string())
        );
        assert_eq!(
            mapped.message["params"]["suggestedRoot"],
            Value::String("/Users/me/.claude".to_string())
        );
    }

    #[test]
    fn session_started_maps_turn_id_when_present() {
        let event = EngineEvent::SessionStarted {
            workspace_id: "ws-claude".to_string(),
            session_id: "ses-123".to_string(),
            engine: EngineType::Claude,
            turn_id: Some("turn-123".to_string()),
        };

        let mapped = engine_event_to_app_server_event(&event, "claude-pending-1", "item-1")
            .expect("mapped event");

        assert_eq!(
            mapped.message["method"],
            Value::String("thread/started".to_string())
        );
        assert_eq!(
            mapped.message["params"]["threadId"],
            Value::String("claude-pending-1".to_string())
        );
        assert_eq!(
            mapped.message["params"]["sessionId"],
            Value::String("ses-123".to_string())
        );
        assert_eq!(
            mapped.message["params"]["turnId"],
            Value::String("turn-123".to_string())
        );
    }

    #[test]
    fn claude_runtime_model_raw_event_keeps_raw_method_and_injects_thread_id() {
        let event = EngineEvent::Raw {
            workspace_id: "ws-model".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "runtime_model",
                "subtype": "assistant.message.model",
                "model": "deepseek-v4-pro-0813[1m]",
            }),
        };

        let mapped = engine_event_to_app_server_event(&event, "claude:session-1", "item-1")
            .expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("claude/raw".to_string())
        );
        assert_eq!(
            mapped.message["params"]["threadId"],
            Value::String("claude:session-1".to_string())
        );
        assert_eq!(
            mapped.message["params"]["model"],
            Value::String("deepseek-v4-pro-0813[1m]".to_string())
        );
    }

    #[test]
    fn claude_permission_denied_raw_event_maps_to_mode_blocked() {
        let event = EngineEvent::Raw {
            workspace_id: "ws-approval".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "permission_denied",
                "source": "claude_permission_denied",
                "blockedMethod": "item/tool/requestUserInput",
                "effectiveMode": "code",
                "reasonCode": "claude_ask_user_question_permission_denied",
                "reason": "Claude denied AskUserQuestion before any approval request reached the GUI.",
                "suggestion": "Use Plan mode for now.",
                "requestId": "tool-ask-1",
            }),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("collaboration/modeBlocked".to_string())
        );
        assert_eq!(
            mapped.message["params"]["blockedMethod"],
            Value::String("item/tool/requestUserInput".to_string())
        );
        assert_eq!(
            mapped.message["params"]["requestId"],
            Value::String("tool-ask-1".to_string())
        );
    }

    #[test]
    fn claude_file_change_permission_denied_raw_event_maps_to_mode_blocked() {
        let event = EngineEvent::Raw {
            workspace_id: "ws-approval".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "permission_denied",
                "source": "claude_permission_denied",
                "blockedMethod": "item/fileChange/requestApproval",
                "effectiveMode": "code",
                "reasonCode": "claude_file_change_permission_denied",
                "reason": "Claude denied a file-change tool before any GUI approval request could start.",
                "suggestion": "Use full-access or manually allow the workspace directory in Claude Code settings.",
                "requestId": "tool-edit-1",
            }),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("collaboration/modeBlocked".to_string())
        );
        assert_eq!(
            mapped.message["params"]["blockedMethod"],
            Value::String("item/fileChange/requestApproval".to_string())
        );
        assert_eq!(
            mapped.message["params"]["reasonCode"],
            Value::String("claude_file_change_permission_denied".to_string())
        );
        assert_eq!(
            mapped.message["params"]["requestId"],
            Value::String("tool-edit-1".to_string())
        );
    }

    #[test]
    fn claude_command_execution_permission_denied_raw_event_maps_to_mode_blocked() {
        let event = EngineEvent::Raw {
            workspace_id: "ws-approval".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "permission_denied",
                "source": "claude_permission_denied",
                "blockedMethod": "item/commandExecution/requestApproval",
                "effectiveMode": "code",
                "reasonCode": "claude_command_execution_permission_denied",
                "reason": "Claude blocked a command-execution tool before any recoverable GUI approval request could start.",
                "suggestion": "Retry in full-access or rewrite the action to use supported file tools.",
                "requestId": "tool-bash-1",
            }),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("collaboration/modeBlocked".to_string())
        );
        assert_eq!(
            mapped.message["params"]["blockedMethod"],
            Value::String("item/commandExecution/requestApproval".to_string())
        );
        assert_eq!(
            mapped.message["params"]["reasonCode"],
            Value::String("claude_command_execution_permission_denied".to_string())
        );
        assert_eq!(
            mapped.message["params"]["requestId"],
            Value::String("tool-bash-1".to_string())
        );
    }

    #[test]
    fn tool_output_delta_maps_to_command_execution_output_delta() {
        let event = EngineEvent::ToolOutputDelta {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-7".to_string(),
            tool_name: Some("exec_command".to_string()),
            delta: "line 1\n".to_string(),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/commandExecution/outputDelta".to_string())
        );
        assert_eq!(
            mapped.message["params"]["itemId"],
            Value::String("tool-7".to_string())
        );
        assert_eq!(
            mapped.message["params"]["delta"],
            Value::String("line 1\n".to_string())
        );
        assert_eq!(
            mapped.message["params"]["tool_tail_marker"],
            Value::Bool(false)
        );
    }

    #[test]
    fn tool_output_delta_sets_tail_marker_for_large_output() {
        let event = EngineEvent::ToolOutputDelta {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-tail".to_string(),
            tool_name: Some("exec_command".to_string()),
            delta: "x".repeat(4097),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/commandExecution/outputDelta".to_string())
        );
        assert_eq!(
            mapped.message["params"]["tool_tail_marker"],
            Value::Bool(true)
        );
    }

    #[test]
    fn tool_started_maps_exec_command_to_command_execution_item() {
        let event = EngineEvent::ToolStarted {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-8".to_string(),
            tool_name: "exec_command".to_string(),
            input: Some(json!({
                "command": "git log --oneline -10",
                "cwd": "/repo",
            })),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/started".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["type"],
            Value::String("commandExecution".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["input"]["command"],
            Value::String("git log --oneline -10".to_string())
        );
    }

    #[test]
    fn tool_started_maps_write_stdin_to_command_execution_item() {
        let event = EngineEvent::ToolStarted {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-stdin".to_string(),
            tool_name: "write_stdin".to_string(),
            input: Some(json!({
                "chars": "y\n",
            })),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["params"]["item"]["type"],
            Value::String("commandExecution".to_string())
        );
    }

    #[test]
    fn tool_completed_maps_exec_command_to_command_execution_item() {
        let event = EngineEvent::ToolCompleted {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-9".to_string(),
            tool_name: Some("exec_command".to_string()),
            output: Some(Value::String("commit-a\ncommit-b".to_string())),
            error: None,
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/completed".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["type"],
            Value::String("commandExecution".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["aggregatedOutput"],
            Value::String("commit-a\ncommit-b".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["output"],
            Value::String("commit-a\ncommit-b".to_string())
        );
        assert_eq!(
            mapped.message["params"]["output"],
            Value::String("commit-a\ncommit-b".to_string())
        );
    }

    #[test]
    fn tool_completed_without_name_does_not_use_call_id_as_title() {
        let event = EngineEvent::ToolCompleted {
            workspace_id: "ws-dsh".to_string(),
            tool_id: "Call-1e9622240-f623-4709-888e-97510eb8c94f-55|fc_dea0cf7d-ffe2-918e-bd8d-1f467cee29d2_0"
                .to_string(),
            tool_name: None,
            output: Some(Value::String("ok".to_string())),
            error: None,
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        let item = &mapped.message["params"]["item"];
        assert_eq!(
            item["id"],
            Value::String(
                "Call-1e9622240-f623-4709-888e-97510eb8c94f-55|fc_dea0cf7d-ffe2-918e-bd8d-1f467cee29d2_0"
                    .to_string()
            )
        );
        assert!(item.get("title").is_none());
        assert!(item.get("tool").is_none());
        assert_eq!(item["status"], Value::String("completed".to_string()));
    }

    #[test]
    fn tool_completed_without_name_classifies_bash_from_command_args() {
        let event = EngineEvent::ToolCompleted {
            workspace_id: "ws-dsh".to_string(),
            tool_id: "call-bash-1".to_string(),
            tool_name: None,
            output: Some(json!({
                "_input": {
                    "command": "git status --short",
                    "description": "Show working tree status"
                },
                "_output": " M src/app.ts"
            })),
            error: None,
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        let item = &mapped.message["params"]["item"];
        assert_eq!(item["type"], Value::String("commandExecution".to_string()));
        assert!(item.get("server").is_none());
        assert_eq!(
            item["input"]["command"],
            Value::String("git status --short".to_string())
        );
    }

    #[test]
    fn tool_input_updated_maps_to_item_updated() {
        let event = EngineEvent::ToolInputUpdated {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-10".to_string(),
            tool_name: Some("exec_command".to_string()),
            input: Some(json!({
                "command": "pwd",
            })),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/updated".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["input"]["command"],
            Value::String("pwd".to_string())
        );
    }

    #[test]
    fn tool_output_delta_maps_apply_patch_to_file_change_output_delta() {
        let event = EngineEvent::ToolOutputDelta {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-patch".to_string(),
            tool_name: Some("apply_patch".to_string()),
            delta: "*** Update File: src/App.tsx".to_string(),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/fileChange/outputDelta".to_string())
        );
    }

    #[test]
    fn tool_output_delta_maps_replace_tool_to_file_change_output_delta() {
        let event = EngineEvent::ToolOutputDelta {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-replace".to_string(),
            tool_name: Some("replace-1774440197988-0 README.md".to_string()),
            delta: "updated README snippet".to_string(),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/fileChange/outputDelta".to_string())
        );
    }

    #[test]
    fn tool_started_maps_todo_write_to_mcp_item_and_keeps_todos() {
        let todos = json!([{ "content": "step", "status": "in_progress" }]);
        for tool_name in ["todo_write", "TodoWrite", "mcp__agent__TodoWrite"] {
            let event = EngineEvent::ToolStarted {
                workspace_id: "ws-live".to_string(),
                tool_id: format!("tool-{tool_name}"),
                tool_name: tool_name.to_string(),
                input: Some(json!({ "todos": todos })),
            };
            let mapped = engine_event_to_app_server_event(&event, "thread-1", "item-1")
                .expect("mapped event");
            assert_eq!(
                mapped.message["method"],
                Value::String("item/started".to_string()),
                "{tool_name}"
            );
            assert_eq!(
                mapped.message["params"]["item"]["type"],
                Value::String("mcpToolCall".to_string()),
                "{tool_name}"
            );
            assert_eq!(
                mapped.message["params"]["item"]["title"],
                Value::String(tool_name.to_string()),
                "{tool_name}"
            );
            assert_eq!(
                mapped.message["params"]["item"]["arguments"]["todos"], todos,
                "{tool_name}"
            );
        }
    }

    #[test]
    fn tool_started_maps_real_write_tools_to_file_change() {
        for tool_name in ["write", "write_file", "Write"] {
            let event = EngineEvent::ToolStarted {
                workspace_id: "ws-live".to_string(),
                tool_id: format!("tool-{tool_name}"),
                tool_name: tool_name.to_string(),
                input: Some(json!({ "path": "src/a.ts", "content": "ok" })),
            };
            let mapped = engine_event_to_app_server_event(&event, "thread-1", "item-1")
                .expect("mapped event");
            assert_eq!(
                mapped.message["params"]["item"]["type"],
                Value::String("fileChange".to_string()),
                "{tool_name}"
            );
        }
    }

    #[test]
    fn approval_request_maps_todo_write_to_generic_approval() {
        let event = EngineEvent::ApprovalRequest {
            workspace_id: "ws-approval".to_string(),
            request_id: json!("req-todo"),
            tool_name: "todo_write".to_string(),
            input: Some(json!({
                "todos": [{ "content": "step", "status": "pending" }]
            })),
            message: Some("update todos".to_string()),
        };
        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("approval/request".to_string())
        );
    }

    #[test]
    fn tool_started_maps_generic_replace_tool_to_mcp_item() {
        let event = EngineEvent::ToolStarted {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-replace-generic".to_string(),
            tool_name: "replace_variables".to_string(),
            input: Some(json!({
                "variables": ["A", "B"]
            })),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/started".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["type"],
            Value::String("mcpToolCall".to_string())
        );
    }

    #[test]
    fn tool_started_maps_replace_tool_to_file_change_item() {
        let event = EngineEvent::ToolStarted {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-replace".to_string(),
            tool_name: "replace-1774440197988-0 README.md".to_string(),
            input: Some(json!({
                "instruction": "update docs",
                "old_string": "old",
                "new_string": "new"
            })),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/started".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["type"],
            Value::String("fileChange".to_string())
        );
    }

    #[test]
    fn claude_raw_compacting_maps_to_thread_compacting() {
        let event = EngineEvent::Raw {
            workspace_id: "ws-compact".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "system",
                "subtype": "compacting",
                "usage_percent": 96,
                "threshold_percent": 95,
                "target_percent": 70,
            }),
        };

        let mapped = engine_event_to_app_server_event(&event, "claude:thread-1", "item-1")
            .expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("thread/compacting".to_string())
        );
        assert_eq!(
            mapped.message["params"]["usagePercent"],
            Value::Number(96.into())
        );
        assert_eq!(
            mapped.message["params"]["thresholdPercent"],
            Value::Number(95.into())
        );
        assert_eq!(
            mapped.message["params"]["targetPercent"],
            Value::Number(70.into())
        );
    }

    #[test]
    fn claude_raw_compact_boundary_maps_to_thread_compacted() {
        let event = EngineEvent::Raw {
            workspace_id: "ws-compact".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "system",
                "event": "compact_boundary",
            }),
        };

        let mapped = engine_event_to_app_server_event(&event, "claude:thread-1", "item-42")
            .expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("thread/compacted".to_string())
        );
        assert_eq!(
            mapped.message["params"]["threadId"],
            Value::String("claude:thread-1".to_string())
        );
        assert_eq!(
            mapped.message["params"]["turnId"],
            Value::String("item-42".to_string())
        );
    }

    #[test]
    fn claude_raw_compaction_failed_maps_to_thread_compaction_failed() {
        let event = EngineEvent::Raw {
            workspace_id: "ws-compact".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "system",
                "subtype": "compaction_failed",
                "reason": "auto compact failed",
            }),
        };

        let mapped = engine_event_to_app_server_event(&event, "claude:thread-1", "item-1")
            .expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("thread/compactionFailed".to_string())
        );
        assert_eq!(
            mapped.message["params"]["reason"],
            Value::String("auto compact failed".to_string())
        );
    }

    #[test]
    fn non_claude_raw_compaction_signal_stays_raw_passthrough() {
        let event = EngineEvent::Raw {
            workspace_id: "ws-compact".to_string(),
            engine: EngineType::OpenCode,
            data: json!({
                "type": "system",
                "subtype": "compacting",
            }),
        };

        let mapped = engine_event_to_app_server_event(&event, "opencode:thread-1", "item-1")
            .expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("opencode/raw".to_string())
        );
    }
}
