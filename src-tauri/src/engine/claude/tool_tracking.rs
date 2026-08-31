use super::*;

#[derive(Debug, Clone)]
pub(super) struct PendingClaudeTool {
    turn_id: String,
    tool_id: String,
    tool_name: String,
    input_signature: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PendingClaudeToolSummary {
    tool_id: String,
    tool_name: String,
}


impl ClaudeSession {
    pub(super) fn resolve_tool_use_id(&self, block: &Value, index: Option<i64>) -> Option<String> {
        if let Some(id) = extract_string_field(
            block,
            &[
                "id",
                "tool_use_id",
                "toolUseId",
                "tool_useId",
                "toolId",
                "tool_id",
            ],
        ) {
            return Some(id);
        }
        index.map(|value| format!("tool-block-{}", value))
    }

    pub(super) fn resolve_tool_result_id(
        &self,
        turn_id: &str,
        block: &Value,
        index: Option<i64>,
    ) -> Option<String> {
        if let Some(id) = extract_string_field(
            block,
            &["tool_use_id", "toolUseId", "tool_useId", "toolUseID"],
        ) {
            return Some(id);
        }
        if let Some(mapped) = self.tool_id_for_block_index(turn_id, index) {
            return Some(mapped);
        }
        if let Some(id) = extract_string_field(block, &["tool_id", "toolId", "id"]) {
            return Some(id);
        }
        self.match_pending_tool_result(turn_id, block)
            .or_else(|| self.latest_pending_tool_id(turn_id))
    }

    pub(super) fn cache_tool_name(&self, tool_id: &str, tool_name: &str) {
        if tool_id.is_empty() || tool_name.is_empty() {
            return;
        }
        if let Ok(mut map) = self.tool_name_by_id.lock() {
            map.insert(tool_id.to_string(), tool_name.to_string());
        }
    }

    pub(super) fn peek_tool_name(&self, tool_id: &str) -> Option<String> {
        if tool_id.is_empty() {
            return None;
        }
        self.tool_name_by_id
            .lock()
            .ok()
            .and_then(|map| map.get(tool_id).cloned())
    }

    pub(super) fn take_tool_name(&self, tool_id: &str) -> Option<String> {
        if tool_id.is_empty() {
            return None;
        }
        self.tool_name_by_id
            .lock()
            .ok()
            .and_then(|mut map| map.remove(tool_id))
    }

    pub(super) fn cache_tool_block_index(&self, turn_id: &str, index: i64, tool_id: &str) {
        if tool_id.is_empty() {
            return;
        }
        if let Ok(mut map) = self.tool_id_by_block_index.lock() {
            map.insert((turn_id.to_string(), index), tool_id.to_string());
        }
    }

    pub(super) fn tool_id_for_block_index(&self, turn_id: &str, index: Option<i64>) -> Option<String> {
        let index = index?;
        self.tool_id_by_block_index
            .lock()
            .ok()
            .and_then(|map| map.get(&(turn_id.to_string(), index)).cloned())
    }

    pub(super) fn clear_tool_block_index(&self, turn_id: &str, index: Option<i64>) {
        if let Some(index) = index {
            if let Ok(mut map) = self.tool_id_by_block_index.lock() {
                map.remove(&(turn_id.to_string(), index));
            }
        }
    }

    pub(super) fn clear_tool_block_indices_for_tool(&self, turn_id: &str, tool_id: &str) {
        if tool_id.is_empty() {
            return;
        }
        if let Ok(mut map) = self.tool_id_by_block_index.lock() {
            map.retain(|(mapped_turn_id, _), mapped_tool_id| {
                !(mapped_turn_id == turn_id && mapped_tool_id == tool_id)
            });
        }
    }

    pub(super) fn clear_tool_block_tracking(&self, turn_id: &str, tool_id: &str, index: Option<i64>) {
        self.clear_tool_block_index(turn_id, index);
        self.clear_tool_block_indices_for_tool(turn_id, tool_id);
    }

    pub(super) fn register_pending_tool(
        &self,
        turn_id: &str,
        tool_id: &str,
        tool_name: &str,
        input: Option<&Value>,
    ) {
        if tool_id.is_empty() || tool_name.is_empty() {
            return;
        }
        let input_signature = input.and_then(tool_input_signature);
        if let Ok(mut pending) = self.pending_tools.lock() {
            pending.retain(|entry| entry.tool_id != tool_id);
            pending.push(PendingClaudeTool {
                turn_id: turn_id.to_string(),
                tool_id: tool_id.to_string(),
                tool_name: tool_name.to_string(),
                input_signature,
            });
        }
    }

    pub(super) fn clear_pending_tool(&self, tool_id: &str) {
        if tool_id.is_empty() {
            return;
        }
        if let Ok(mut pending) = self.pending_tools.lock() {
            pending.retain(|entry| entry.tool_id != tool_id);
        }
    }

    pub(super) fn match_pending_tool_result(&self, turn_id: &str, block: &Value) -> Option<String> {
        let tool_name = extract_claude_tool_name(block)?;
        let input_signature =
            extract_claude_tool_input(block).and_then(|value| tool_input_signature(&value));
        let pending = self.pending_tools.lock().ok()?;

        if let Some(expected_input) = input_signature.as_deref() {
            if let Some(entry) = pending.iter().rev().find(|entry| {
                entry.turn_id == turn_id
                    && entry.tool_name == tool_name
                    && entry.input_signature.as_deref() == Some(expected_input)
            }) {
                return Some(entry.tool_id.clone());
            }
        }

        pending
            .iter()
            .rev()
            .find(|entry| entry.turn_id == turn_id && entry.tool_name == tool_name)
            .map(|entry| entry.tool_id.clone())
    }

    pub(super) fn latest_pending_tool_id(&self, turn_id: &str) -> Option<String> {
        let pending = self.pending_tools.lock().ok()?;
        pending
            .iter()
            .rev()
            .find(|entry| entry.turn_id == turn_id)
            .map(|entry| entry.tool_id.clone())
    }

    pub(super) fn latest_pending_tool_summary(&self, turn_id: &str) -> Option<PendingClaudeToolSummary> {
        let pending = self.pending_tools.lock().ok()?;
        pending
            .iter()
            .rev()
            .find(|entry| entry.turn_id == turn_id)
            .map(|entry| PendingClaudeToolSummary {
                tool_id: entry.tool_id.clone(),
                tool_name: entry.tool_name.clone(),
            })
    }

    pub(super) fn build_mode_blocked_signal_from_error(
        &self,
        turn_id: &str,
        error_message: &str,
    ) -> Option<EngineEvent> {
        if !looks_like_claude_permission_denial_message(error_message) {
            return None;
        }

        let pending_tool = self.latest_pending_tool_summary(turn_id)?;
        let tool_input = self.peek_tool_input_value(&pending_tool.tool_id);
        let blocked_kind = classify_claude_mode_blocked_tool(&pending_tool.tool_name)?;
        let should_emit_synthetic_approval = match blocked_kind {
            ClaudeModeBlockedKind::FileChange => true,
            ClaudeModeBlockedKind::CommandExecution => tool_input
                .as_ref()
                .and_then(extract_claude_command_string)
                .as_deref()
                .map(command_can_apply_as_local_file_action)
                .unwrap_or(false),
            ClaudeModeBlockedKind::RequestUserInput => false,
        };

        if should_emit_synthetic_approval {
            if let Ok(mut pending) = self.pending_approval_requests.lock() {
                pending.insert(pending_tool.tool_id.clone(), turn_id.to_string());
            }
            return Some(EngineEvent::ApprovalRequest {
                workspace_id: self.workspace_id.clone(),
                request_id: Value::String(pending_tool.tool_id.clone()),
                tool_name: pending_tool.tool_name.clone(),
                input: tool_input,
                message: Some(
                    "Approve to let the GUI apply this file change locally. Preview currently supports structured file tools plus safe single-path file commands.".to_string(),
                ),
            });
        }

        let (blocked_method, reason_code, reason, suggestion) = match blocked_kind {
            ClaudeModeBlockedKind::RequestUserInput => (
                "item/tool/requestUserInput",
                "claude_ask_user_question_permission_denied",
                "Claude denied AskUserQuestion before any approval request reached the GUI.",
                "Claude default mode remains gated. Use Plan mode when the workflow needs AskUserQuestion or other interactive clarification.",
            ),
            ClaudeModeBlockedKind::FileChange => (
                "item/fileChange/requestApproval",
                "claude_file_change_permission_denied",
                "Claude denied a file-change tool before any GUI approval request could start.",
                "Claude preview can bridge Write/CreateFile/CreateDirectory after approval. Other file tools still need full-access or a retry after changing Claude Code settings.",
            ),
            ClaudeModeBlockedKind::CommandExecution => (
                "item/commandExecution/requestApproval",
                "claude_command_execution_permission_denied",
                "Claude blocked a command-execution tool before any recoverable GUI approval request could start.",
                "Claude default mode cannot recover blocked Bash/command tools through the GUI approval bridge yet. Retry in full-access or rewrite the action to use supported file tools.",
            ),
        };

        Some(EngineEvent::Raw {
            workspace_id: self.workspace_id.clone(),
            engine: EngineType::Claude,
            data: json!({
                "type": "permission_denied",
                "source": "claude_permission_denied",
                "blockedMethod": blocked_method,
                "blocked_method": blocked_method,
                "effectiveMode": "code",
                "effective_mode": "code",
                "reasonCode": reason_code,
                "reason_code": reason_code,
                "reason": reason,
                "suggestion": suggestion,
                "requestId": pending_tool.tool_id,
                "request_id": pending_tool.tool_id,
                "toolName": pending_tool.tool_name,
                "tool_name": pending_tool.tool_name,
                "rawError": error_message,
                "raw_error": error_message,
            }),
        })
    }

    pub(super) fn sanitize_runtime_model(model: &str) -> Option<String> {
        let trimmed = model.trim();
        if trimmed.is_empty() {
            return None;
        }
        let lowered = trimmed.to_ascii_lowercase();
        if lowered == "<synthetic>" || lowered == "synthetic" {
            return None;
        }
        Some(trimmed.to_string())
    }

    pub(super) fn maybe_emit_runtime_model(
        &self,
        turn_id: &str,
        model: Option<&str>,
        source: &str,
    ) {
        let Some(model) = model.and_then(Self::sanitize_runtime_model) else {
            return;
        };
        let should_emit = if let Ok(mut map) = self.emitted_runtime_model_by_turn.lock() {
            match map.get(turn_id) {
                Some(previous) if previous == &model => false,
                _ => {
                    map.insert(turn_id.to_string(), model.clone());
                    true
                }
            }
        } else {
            true
        };
        if !should_emit {
            return;
        }
        self.emit_turn_event(
            turn_id,
            EngineEvent::Raw {
                workspace_id: self.workspace_id.clone(),
                engine: EngineType::Claude,
                data: json!({
                    "type": "runtime_model",
                    "subtype": source,
                    "model": model,
                }),
            },
        );
    }

    /// Compute the true delta from a cumulative assistant text.
    /// If the cumulative text starts with the previously emitted text,
    /// return only the new portion. Otherwise return the full text
    /// (this handles edge cases like context compaction).
    pub(super) fn compute_text_delta(&self, turn_id: &str, cumulative: &str) -> String {
        if let Ok(mut map) = self.last_emitted_text_by_turn.lock() {
            let last = map.entry(turn_id.to_string()).or_default();
            if cumulative.starts_with(last.as_str()) {
                let delta = cumulative[last.len()..].to_string();
                *last = cumulative.to_string();
                return delta;
            }
            if last.starts_with(cumulative) {
                return String::new();
            }
            // Cumulative text doesn't extend the previous — emit full text
            *last = cumulative.to_string();
        }
        cumulative.to_string()
    }

    /// Keep the emitted-text tracker aligned when Claude streams raw deltas
    /// before it later sends a cumulative assistant snapshot.
    pub(super) fn track_emitted_text_delta(&self, turn_id: &str, delta: &str) {
        if delta.is_empty() {
            return;
        }
        if let Ok(mut map) = self.last_emitted_text_by_turn.lock() {
            let last = map.entry(turn_id.to_string()).or_default();
            *last = merge_text_chunks(last, delta);
        }
    }

    pub(super) fn append_tool_input(&self, tool_id: &str, partial: &str) -> Option<Value> {
        if tool_id.is_empty() || partial.is_empty() {
            return None;
        }
        if let Ok(mut map) = self.tool_input_by_id.lock() {
            let entry = map.entry(tool_id.to_string()).or_default();
            entry.push_str(partial);
            if let Ok(value) = serde_json::from_str::<Value>(entry) {
                return Some(value);
            }
        }
        None
    }

    pub(super) fn cache_tool_input_value(&self, tool_id: &str, input: &Value) {
        if tool_id.is_empty() {
            return;
        }
        if let Ok(mut map) = self.tool_input_value_by_id.lock() {
            map.insert(tool_id.to_string(), input.clone());
        }
    }

    pub(super) fn take_tool_input_value(&self, tool_id: &str) -> Option<Value> {
        if tool_id.is_empty() {
            return None;
        }
        self.tool_input_value_by_id
            .lock()
            .ok()
            .and_then(|mut map| map.remove(tool_id))
    }

    pub(super) fn peek_tool_input_value(&self, tool_id: &str) -> Option<Value> {
        if tool_id.is_empty() {
            return None;
        }
        self.tool_input_value_by_id
            .lock()
            .ok()
            .and_then(|map| map.get(tool_id).cloned())
    }

    pub(super) fn clear_tool_input(&self, tool_id: &str) {
        if tool_id.is_empty() {
            return;
        }
        if let Ok(mut map) = self.tool_input_by_id.lock() {
            map.remove(tool_id);
        }
        if let Ok(mut map) = self.tool_input_value_by_id.lock() {
            map.remove(tool_id);
        }
    }

    pub(super) fn take_tool_completion_state(&self, tool_id: &str) -> (Option<String>, Option<Value>) {
        let tool_name = self.take_tool_name(tool_id);
        let cached_input = self.take_tool_input_value(tool_id);
        self.clear_pending_tool(tool_id);
        self.clear_tool_input(tool_id);
        (tool_name, cached_input)
    }

    pub(super) fn build_tool_completed_with_parts(
        &self,
        tool_id: &str,
        output: Option<String>,
        error: Option<String>,
    ) -> Option<EngineEvent> {
        if tool_id.is_empty() {
            return None;
        }
        let (tool_name, cached_input) = self.take_tool_completion_state(tool_id);
        let output = output.map(|text| {
            if let Some(input) = cached_input.clone() {
                json!({
                    "_input": input,
                    "_output": text,
                })
            } else {
                Value::String(text)
            }
        });
        Some(EngineEvent::ToolCompleted {
            workspace_id: self.workspace_id.clone(),
            tool_id: tool_id.to_string(),
            tool_name,
            output,
            error,
        })
    }

    pub(super) fn emit_tool_completion(
        &self,
        turn_id: &str,
        tool_id: &str,
        output: Option<String>,
        error: Option<String>,
    ) {
        if let Some(event) = self.build_tool_completed_with_parts(tool_id, output, error) {
            self.emit_turn_event(turn_id, event);
        }
    }

    pub(super) fn build_tool_completed(
        &self,
        tool_id: &str,
        output: Option<String>,
        is_error: bool,
    ) -> Option<EngineEvent> {
        let error = if is_error {
            output.clone().filter(|text| !text.trim().is_empty())
        } else {
            None
        };
        let output = if is_error { None } else { output };
        self.build_tool_completed_with_parts(tool_id, output, error)
    }

    pub(super) fn build_tool_output_delta(&self, tool_id: &str, delta: &str) -> Option<EngineEvent> {
        let trimmed = delta.trim_end();
        if tool_id.is_empty() || trimmed.is_empty() {
            return None;
        }
        Some(EngineEvent::ToolOutputDelta {
            workspace_id: self.workspace_id.clone(),
            tool_id: tool_id.to_string(),
            tool_name: self.peek_tool_name(tool_id),
            delta: trimmed.to_string(),
        })
    }
}
