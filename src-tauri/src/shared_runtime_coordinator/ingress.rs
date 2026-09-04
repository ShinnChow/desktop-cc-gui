//! Runtime event 入口与管线：Engine/Codex/AppServer event → RuntimeIngress 归一化、
//! terminal evidence 提取，以及 Shared owner 的 AppServer payload 投影。

use serde_json::json;

use crate::engine::codex_prompt_service::{
    extract_agent_message_snapshot_text, extract_codex_reasoning_delta, extract_codex_text_delta,
    extract_turn_completed_text,
};

use super::*;

pub(crate) fn project_app_server_event_to_shared_owner(
    event: &mut AppServerEvent,
    owner: &SharedRuntimeAttemptOwner,
) {
    let requires_binding_recovery = owner.engine == EngineType::Claude
        && is_missing_native_session_error(&event.message.to_string());
    let native_thread_id = crate::backend::app_server::extract_thread_id(&event.message)
        .filter(|thread_id| !thread_id.starts_with("shared:"))
        .or_else(|| owner.native_session_id.clone());
    // Read method before mutably borrowing params (same message object).
    let method = event
        .message
        .get("method")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    // Control-plane methods are fail-closed on the frontend: params.turnId must
    // equal sharedOwner.runtimeTurnId. Claude historically mapped
    // requestUserInput.turnId to the assistant item id; force-align here so
    // Shared AskUserQuestion / approval cards are not silently dropped.
    let force_control_turn_identity = method == "item/tool/requestUserInput"
        || method == "approval/request"
        || method == "collaboration/modeBlocked"
        || method.contains("requestApproval");
    let params = event.message.as_object_mut().and_then(|message| {
        message
            .entry("params".to_string())
            .or_insert_with(|| json!({}))
            .as_object_mut()
    });
    let Some(params) = params else {
        return;
    };

    params.insert(
        "threadId".to_string(),
        Value::String(owner.shared_thread_id.clone()),
    );
    params.insert(
        "thread_id".to_string(),
        Value::String(owner.shared_thread_id.clone()),
    );
    rewrite_nested_thread_identity(params.get_mut("turn"), &owner.shared_thread_id);
    rewrite_nested_thread_identity(params.get_mut("thread"), &owner.shared_thread_id);

    if let Some(native_thread_id) = native_thread_id.as_deref() {
        params.insert(
            "nativeThreadId".to_string(),
            Value::String(native_thread_id.to_string()),
        );
        params.insert(
            "native_thread_id".to_string(),
            Value::String(native_thread_id.to_string()),
        );
    }
    if let Some(runtime_turn_id) = owner.runtime_turn_id.as_deref() {
        if force_control_turn_identity {
            params.insert(
                "turnId".to_string(),
                Value::String(runtime_turn_id.to_string()),
            );
            params.insert(
                "turn_id".to_string(),
                Value::String(runtime_turn_id.to_string()),
            );
        } else {
            params
                .entry("turnId".to_string())
                .or_insert_with(|| Value::String(runtime_turn_id.to_string()));
            params
                .entry("turn_id".to_string())
                .or_insert_with(|| Value::String(runtime_turn_id.to_string()));
        }
    }
    params.insert(
        "sharedOwner".to_string(),
        json!({
            "sharedSessionId": owner.shared_session_id,
            "sharedThreadId": owner.shared_thread_id,
            "providerRuntimeKey": owner.provider_runtime_key,
            "nativeThreadId": native_thread_id,
            "runtimeTurnId": owner.runtime_turn_id,
            "logicalTurnId": owner.logical_turn_id,
            "attemptId": owner.attempt_id,
            "bindingKey": owner.binding_key,
            "bindingOperationId": owner.binding_operation_id,
            "engine": engine_token(owner.engine),
            "executionTargetSnapshot": execution_target_snapshot_wire(
                &owner.execution_target_snapshot
            ),
        }),
    );
    if requires_binding_recovery {
        params.insert(
            "sharedRecoveryReason".to_string(),
            Value::String("native-session-not-found".to_string()),
        );
    }
}

pub(crate) fn execution_target_snapshot_wire(snapshot: &TurnExecutionSnapshot) -> Value {
    json!({
        "engine": snapshot.engine,
        "providerProfileId": snapshot.provider_profile_id,
        "modelCatalogEntryId": snapshot.model_catalog_entry_id,
        "model": snapshot.model,
        "reasoning": snapshot.reasoning,
        "providerProfileNameSnapshot": snapshot.provider_profile_name_snapshot,
        "providerProfileSource": snapshot.provider_profile_source,
        "runtimeCapabilityFingerprint": snapshot.runtime_capability_fingerprint,
    })
}

pub(crate) fn rewrite_nested_thread_identity(value: Option<&mut Value>, shared_thread_id: &str) {
    let Some(object) = value.and_then(Value::as_object_mut) else {
        return;
    };
    object.insert(
        "threadId".to_string(),
        Value::String(shared_thread_id.to_string()),
    );
    object.insert(
        "thread_id".to_string(),
        Value::String(shared_thread_id.to_string()),
    );
}

pub(crate) fn normalize_engine_ingress(
    provider_runtime_key: &str,
    engine: EngineType,
    runtime_turn_id: Option<&str>,
    native_session_id: Option<&str>,
    event: &EngineEvent,
) -> RuntimeIngress {
    let mut actions = Vec::new();
    let mut suppress_agent_event = false;
    match event {
        EngineEvent::SessionStarted { session_id, .. } => {
            return RuntimeIngress {
                workspace_id: event.workspace_id().to_string(),
                engine,
                provider_runtime_key: provider_runtime_key.to_string(),
                runtime_turn_id: normalize_identity(runtime_turn_id).map(str::to_string),
                native_session_id: normalize_native_session_identity(
                    engine,
                    Some(provider_runtime_key),
                    Some(session_id.as_str()),
                )
                .or_else(|| {
                    normalize_native_session_identity(
                        engine,
                        Some(provider_runtime_key),
                        native_session_id,
                    )
                }),
                is_session_started: true,
                actions,
                agent_event: Some(event.clone()),
                replay_app_server_events: Vec::new(),
            };
        }
        EngineEvent::TurnStarted { turn_id, .. } => {
            return RuntimeIngress {
                workspace_id: event.workspace_id().to_string(),
                engine,
                provider_runtime_key: provider_runtime_key.to_string(),
                runtime_turn_id: normalize_identity(Some(turn_id.as_str()))
                    .or_else(|| normalize_identity(runtime_turn_id))
                    .map(str::to_string),
                native_session_id: normalize_native_session_identity(
                    engine,
                    Some(provider_runtime_key),
                    native_session_id,
                ),
                is_session_started: false,
                actions,
                agent_event: Some(event.clone()),
                replay_app_server_events: Vec::new(),
            };
        }
        EngineEvent::TextDelta { text, .. } => {
            actions.push(AccumulatorAction::AssistantDelta(text.clone()));
        }
        EngineEvent::ReasoningDelta { text, .. } => {
            actions.push(AccumulatorAction::ReasoningDelta(text.clone()));
        }
        EngineEvent::ToolStarted {
            tool_id,
            tool_name,
            input,
            ..
        } => actions.push(AccumulatorAction::ToolStarted {
            tool_id: tool_id.clone(),
            tool_name: tool_name.clone(),
            input: input.clone(),
        }),
        EngineEvent::ToolInputUpdated {
            tool_id,
            tool_name,
            input,
            ..
        } => actions.push(AccumulatorAction::ToolInputUpdated {
            tool_id: tool_id.clone(),
            tool_name: tool_name.clone(),
            input: input.clone(),
        }),
        EngineEvent::ToolOutputDelta { tool_id, delta, .. } => {
            actions.push(AccumulatorAction::ToolOutputDelta {
                tool_id: tool_id.clone(),
                delta: delta.clone(),
            });
        }
        EngineEvent::ToolCompleted {
            tool_id,
            tool_name,
            output,
            error,
            ..
        } => actions.push(AccumulatorAction::ToolCompleted {
            tool_id: tool_id.clone(),
            tool_name: tool_name.clone(),
            output: output.clone(),
            error: error.clone(),
        }),
        EngineEvent::TurnCompleted { result, .. } => {
            let result = result.as_ref();
            actions.push(AccumulatorAction::Terminal(TerminalEvidence {
                outcome: completion_outcome(result),
                error_code: value_string_by_aliases(result, &["errorCode", "error_code", "code"]),
                error_message: value_string_by_aliases(
                    result,
                    &["errorMessage", "error_message", "error"],
                ),
                stop_reason: value_string_by_aliases(
                    result,
                    &["stopReason", "stop_reason", "reason"],
                ),
                fallback_text: crate::engine::commands::extract_turn_result_text(result),
                artifacts: result
                    .map(extract_explicit_artifact_refs)
                    .unwrap_or_default(),
                provider_private_refs: deserialize_vec_by_aliases(
                    result,
                    &["providerPrivateRefs", "provider_private_refs"],
                ),
                omissions: deserialize_vec_by_aliases(result, &["omissions"]),
            }));
        }
        EngineEvent::TurnError { error, code, .. } => {
            actions.push(AccumulatorAction::Terminal(TerminalEvidence {
                outcome: OutcomeStatus::Failed,
                error_code: code.clone(),
                error_message: Some(error.clone()),
                stop_reason: None,
                fallback_text: None,
                artifacts: Vec::new(),
                provider_private_refs: Vec::new(),
                omissions: Vec::new(),
            }));
        }
        EngineEvent::Raw { data, .. } => {
            if engine == EngineType::Claude {
                if let Some(echo) = extract_claude_replay_echo(data) {
                    actions.push(AccumulatorAction::ContextEcho(echo));
                    // replay echo 是 transport-level ACK，不是用户输入，也不是 assistant
                    // content。禁止进入 AgentEventBus/history/UI raw fan-out。
                    suppress_agent_event = true;
                }
                if let Some(terminal) = claude_result_terminal_evidence(data) {
                    // Claude CLI 的 `result` packet 是业务回合已经结束的 typed
                    // evidence；后续 stdout/stderr drain 与 process reap 只是 Runtime
                    // cleanup。Native Claude 仍等待 canonical TurnCompleted，Shared
                    // attempt 则必须在这里先收口，不能让清理延迟继续占用 Stop/UI lock。
                    actions.push(AccumulatorAction::Terminal(terminal));
                }
            }
            let artifacts = extract_explicit_artifact_refs(data);
            if !artifacts.is_empty() {
                actions.push(AccumulatorAction::Artifacts(artifacts));
            }
        }
        _ => {}
    }
    RuntimeIngress {
        workspace_id: event.workspace_id().to_string(),
        engine,
        provider_runtime_key: provider_runtime_key.to_string(),
        runtime_turn_id: normalize_identity(runtime_turn_id).map(str::to_string),
        native_session_id: normalize_native_session_identity(
            engine,
            Some(provider_runtime_key),
            native_session_id,
        ),
        is_session_started: false,
        actions,
        agent_event: (!suppress_agent_event).then(|| event.clone()),
        replay_app_server_events: Vec::new(),
    }
}

pub(crate) fn claude_result_terminal_evidence(data: &Value) -> Option<TerminalEvidence> {
    let event_type = data
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if !event_type.eq_ignore_ascii_case("result") {
        return None;
    }

    let subtype = data
        .get("subtype")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let terminal_reason = value_string_by_aliases(
        Some(data),
        &[
            "terminalReason",
            "terminal_reason",
            "stopReason",
            "stop_reason",
        ],
    );
    let is_failed = data
        .get("is_error")
        .or_else(|| data.get("isError"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || matches!(
            subtype.as_str(),
            "error" | "failed" | "failure" | "error_during_execution"
        )
        || subtype.starts_with("error_");

    let fallback_text = (!is_failed)
        .then(|| crate::engine::commands::extract_turn_result_text(Some(data)))
        .flatten();
    let result_text = crate::engine::commands::extract_turn_result_text(Some(data));
    let error_message = if is_failed {
        value_string_by_aliases(Some(data), &["errorMessage", "error_message", "message"])
            .or_else(|| {
                data.get("error")
                    .and_then(|error| value_string_by_aliases(Some(error), &["message"]))
            })
            .or(result_text)
    } else {
        None
    };

    Some(TerminalEvidence {
        outcome: if is_failed {
            OutcomeStatus::Failed
        } else {
            OutcomeStatus::Completed
        },
        error_code: value_string_by_aliases(
            Some(data),
            &[
                "apiErrorStatus",
                "api_error_status",
                "errorCode",
                "error_code",
                "code",
            ],
        ),
        error_message,
        stop_reason: terminal_reason,
        fallback_text,
        artifacts: extract_explicit_artifact_refs(data),
        provider_private_refs: deserialize_vec_by_aliases(
            Some(data),
            &["providerPrivateRefs", "provider_private_refs"],
        ),
        omissions: deserialize_vec_by_aliases(Some(data), &["omissions"]),
    })
}

/// Claude `--replay-user-messages` 回显的 Shared context marker 仅用于强 ACK。
/// 即使 runtime identity 尚未完成绑定，也必须在普通 UI/history fan-out 前过滤。
pub(crate) fn is_internal_shared_context_replay_event(event: &EngineEvent) -> bool {
    matches!(
        event,
        EngineEvent::Raw {
            engine: EngineType::Claude,
            data,
            ..
        } if extract_claude_replay_echo(data).is_some()
    )
}

pub(crate) fn normalize_codex_ingress(
    provider_runtime_key: &str,
    workspace_id: &str,
    event: &Value,
) -> RuntimeIngress {
    let method = event
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let params = event.get("params").unwrap_or(&Value::Null);
    let runtime_turn_id = crate::backend::app_server::extract_turn_id(event);
    let native_session_id = crate::backend::app_server::extract_thread_id(event);
    let mut actions = Vec::new();

    let agent_event = if let Some(text) = extract_codex_text_delta(event) {
        actions.push(AccumulatorAction::AssistantDelta(text.clone()));
        Some(EngineEvent::TextDelta {
            workspace_id: workspace_id.to_string(),
            text,
        })
    } else if let Some(text) = extract_codex_reasoning_delta(event) {
        actions.push(AccumulatorAction::ReasoningDelta(text.clone()));
        Some(EngineEvent::ReasoningDelta {
            workspace_id: workspace_id.to_string(),
            text,
        })
    } else if let Some(text) = extract_agent_message_snapshot_text(event) {
        actions.push(AccumulatorAction::AssistantSnapshot(text));
        Some(EngineEvent::Raw {
            workspace_id: workspace_id.to_string(),
            engine: EngineType::Codex,
            data: event.clone(),
        })
    } else {
        normalize_codex_structured_event(workspace_id, method, params, event, &mut actions)
    };

    let artifacts = extract_explicit_artifact_refs(params);
    if !artifacts.is_empty() {
        actions.push(AccumulatorAction::Artifacts(artifacts));
    }

    RuntimeIngress {
        workspace_id: workspace_id.to_string(),
        engine: EngineType::Codex,
        provider_runtime_key: provider_runtime_key.to_string(),
        runtime_turn_id,
        native_session_id,
        is_session_started: method == "thread/started",
        actions,
        agent_event,
        replay_app_server_events: vec![AppServerEvent {
            workspace_id: workspace_id.to_string(),
            message: event.clone(),
        }],
    }
}

pub(crate) fn normalize_codex_structured_event(
    workspace_id: &str,
    method: &str,
    params: &Value,
    event: &Value,
    actions: &mut Vec<AccumulatorAction>,
) -> Option<EngineEvent> {
    match method {
        "turn/started" => {
            let turn_id = crate::backend::app_server::extract_turn_id(event).unwrap_or_default();
            Some(EngineEvent::TurnStarted {
                workspace_id: workspace_id.to_string(),
                turn_id,
            })
        }
        "thread/started" => {
            let session_id =
                crate::backend::app_server::extract_thread_id(event).unwrap_or_default();
            Some(EngineEvent::SessionStarted {
                workspace_id: workspace_id.to_string(),
                session_id,
                engine: EngineType::Codex,
                turn_id: crate::backend::app_server::extract_turn_id(event),
            })
        }
        "item/started" | "item/updated" | "item/completed" => {
            normalize_codex_item_event(workspace_id, method, params, actions)
        }
        "item/toolStart" => {
            let tool_id = value_string_by_aliases(Some(params), &["toolId", "tool_id", "id"])
                .unwrap_or_else(|| "unknown-tool".to_string());
            let tool_name =
                value_string_by_aliases(Some(params), &["toolName", "tool_name", "name"])
                    .unwrap_or_else(|| tool_id.clone());
            let input = value_by_aliases(params, &["input", "arguments"]).cloned();
            actions.push(AccumulatorAction::ToolStarted {
                tool_id: tool_id.clone(),
                tool_name: tool_name.clone(),
                input: input.clone(),
            });
            Some(EngineEvent::ToolStarted {
                workspace_id: workspace_id.to_string(),
                tool_id,
                tool_name,
                input,
            })
        }
        "item/toolComplete" => {
            let tool_id = value_string_by_aliases(Some(params), &["toolId", "tool_id", "id"])
                .unwrap_or_else(|| "unknown-tool".to_string());
            let tool_name =
                value_string_by_aliases(Some(params), &["toolName", "tool_name", "name"]);
            let output = value_by_aliases(params, &["output", "result"]).cloned();
            let error = value_string_by_aliases(Some(params), &["error", "errorMessage"]);
            actions.push(AccumulatorAction::ToolCompleted {
                tool_id: tool_id.clone(),
                tool_name: tool_name.clone(),
                output: output.clone(),
                error: error.clone(),
            });
            Some(EngineEvent::ToolCompleted {
                workspace_id: workspace_id.to_string(),
                tool_id,
                tool_name,
                output,
                error,
            })
        }
        "turn/completed" => {
            let fallback_text = extract_turn_completed_text(event);
            let evidence = terminal_evidence_from_value(params, fallback_text, false);
            actions.push(AccumulatorAction::Terminal(evidence));
            Some(EngineEvent::TurnCompleted {
                workspace_id: workspace_id.to_string(),
                result: Some(params.clone()),
            })
        }
        "turn/error" | "runtime/ended" => {
            let evidence = terminal_evidence_from_value(params, None, true);
            let error = evidence
                .error_message
                .clone()
                .unwrap_or_else(|| "Codex runtime turn failed".to_string());
            let code = evidence.error_code.clone();
            actions.push(AccumulatorAction::Terminal(evidence));
            Some(EngineEvent::TurnError {
                workspace_id: workspace_id.to_string(),
                error,
                code,
            })
        }
        "error"
            if !params
                .get("willRetry")
                .or_else(|| params.get("will_retry"))
                .and_then(Value::as_bool)
                .unwrap_or(false) =>
        {
            let evidence = terminal_evidence_from_value(params, None, true);
            let error = evidence
                .error_message
                .clone()
                .unwrap_or_else(|| "Codex runtime request failed".to_string());
            let code = evidence.error_code.clone();
            actions.push(AccumulatorAction::Terminal(evidence));
            Some(EngineEvent::TurnError {
                workspace_id: workspace_id.to_string(),
                error,
                code,
            })
        }
        _ => Some(EngineEvent::Raw {
            workspace_id: workspace_id.to_string(),
            engine: EngineType::Codex,
            data: event.clone(),
        }),
    }
}

pub(crate) fn normalize_codex_item_event(
    workspace_id: &str,
    method: &str,
    params: &Value,
    actions: &mut Vec<AccumulatorAction>,
) -> Option<EngineEvent> {
    let item = params.get("item")?;
    if is_assistant_or_reasoning_item(item) {
        return Some(EngineEvent::Raw {
            workspace_id: workspace_id.to_string(),
            engine: EngineType::Codex,
            data: json!({ "method": method, "params": params }),
        });
    }
    let item_type = value_string_by_aliases(Some(item), &["type", "kind"]).unwrap_or_default();
    if !is_tool_item_type(&item_type) {
        return Some(EngineEvent::Raw {
            workspace_id: workspace_id.to_string(),
            engine: EngineType::Codex,
            data: json!({ "method": method, "params": params }),
        });
    }
    let tool_id = value_string_by_aliases(Some(item), &["id", "toolId", "tool_id"])
        .unwrap_or_else(|| "unknown-tool".to_string());
    // Prefer explicit tool name; custom_tool_call uses `name` (e.g. apply_patch).
    // Fall back to item type (e.g. "fileChange") for canvas classifiers.
    let tool_name = value_string_by_aliases(
        Some(item),
        &["tool", "toolName", "tool_name", "name", "title"],
    )
    .unwrap_or_else(|| item_type.clone());
    // Codex fileChange puts paths/diffs on `changes[]`, not `arguments`/`input`.
    // Pack both so SharedProjector can rebuild ConversationItem.changes.
    let input = extract_codex_tool_payload(item);
    if method == "item/started" {
        actions.push(AccumulatorAction::ToolStarted {
            tool_id: tool_id.clone(),
            tool_name: tool_name.clone(),
            input: input.clone(),
        });
        return Some(EngineEvent::ToolStarted {
            workspace_id: workspace_id.to_string(),
            tool_id,
            tool_name,
            input,
        });
    }
    if method == "item/updated" {
        actions.push(AccumulatorAction::ToolInputUpdated {
            tool_id: tool_id.clone(),
            tool_name: Some(tool_name.clone()),
            input: input.clone(),
        });
        return Some(EngineEvent::ToolInputUpdated {
            workspace_id: workspace_id.to_string(),
            tool_id,
            tool_name: Some(tool_name),
            input,
        });
    }

    // Completed snapshots often carry the final `changes[]` only at this step.
    if let Some(payload) = input.clone() {
        actions.push(AccumulatorAction::ToolInputUpdated {
            tool_id: tool_id.clone(),
            tool_name: Some(tool_name.clone()),
            input: Some(payload),
        });
    }
    let output = value_by_aliases(item, &["result", "output", "aggregatedOutput"])
        .or_else(|| value_by_aliases(params, &["result", "output"]))
        .cloned();
    let error = value_string_by_aliases(Some(item), &["error", "errorMessage"])
        .or_else(|| value_string_by_aliases(Some(params), &["error", "errorMessage"]));
    actions.push(AccumulatorAction::ToolCompleted {
        tool_id: tool_id.clone(),
        tool_name: Some(tool_name.clone()),
        output: output.clone(),
        error: error.clone(),
    });
    Some(EngineEvent::ToolCompleted {
        workspace_id: workspace_id.to_string(),
        tool_id,
        tool_name: Some(tool_name),
        output,
        error,
    })
}

/// Build a portable tool payload for Shared canonical storage.
///
/// Codex `fileChange` items put path/diff on `changes[]` (not `arguments`).
/// Codex `apply_patch` often arrives as `custom_tool_call` with a raw patch string
/// in `input`. Both must be packed or history cannot rebuild the file-edit scene.
pub(crate) fn extract_codex_tool_payload(item: &Value) -> Option<Value> {
    let mut object = serde_json::Map::new();

    match value_by_aliases(item, &["arguments", "input"]) {
        Some(Value::Object(map)) => {
            for (key, value) in map {
                object.insert(key.clone(), value.clone());
            }
        }
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                object.insert("input".to_string(), Value::String(trimmed.to_string()));
                // Preserve patch-shaped strings under an explicit key for projection.
                if trimmed.contains("*** Begin Patch") || trimmed.contains("*** Update File:") {
                    object.insert("patch".to_string(), Value::String(trimmed.to_string()));
                }
            }
        }
        Some(value) if !value.is_null() => {
            object.insert("input".to_string(), value.clone());
        }
        _ => {}
    }

    if let Some(changes) = item.get("changes") {
        if changes.as_array().is_some_and(|rows| !rows.is_empty()) {
            object.insert("changes".to_string(), changes.clone());
        }
    }

    // custom_tool_call / function_call name (apply_patch, shell, …)
    if let Some(name) =
        value_string_by_aliases(Some(item), &["name", "tool", "toolName", "tool_name"])
    {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            object.insert("name".to_string(), Value::String(trimmed.to_string()));
        }
    }

    if let Some(title) = item.get("title").and_then(Value::as_str) {
        let trimmed = title.trim();
        if !trimmed.is_empty() {
            object.insert("title".to_string(), Value::String(trimmed.to_string()));
        }
    }

    // commandExecution-shaped fields. Codex often sends `command` as a string[] argv
    // (e.g. ["cat","README.md"] or apply_patch + patch body). We must join argv into a
    // single string or Shared history loses the command text and cannot promote
    // apply_patch → fileChange.
    for key in ["cwd", "description"] {
        if let Some(Value::String(text)) = item.get(key) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                object.insert(key.to_string(), Value::String(trimmed.to_string()));
            }
        }
    }
    if let Some(command) = coerce_command_field(item.get("command").or_else(|| item.get("cmd"))) {
        let looks_like_patch = command.contains("*** Begin Patch")
            || command.contains("*** Update File:")
            || command.to_ascii_lowercase().contains("apply_patch");
        object.insert("command".to_string(), Value::String(command.clone()));
        if looks_like_patch {
            object.insert("patch".to_string(), Value::String(command));
        }
    }

    if object.is_empty() {
        None
    } else {
        Some(Value::Object(object))
    }
}

/// Normalize Codex command field: string as-is, string[] joined with spaces.
pub(crate) fn coerce_command_field(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Some(Value::Array(parts)) => {
            let joined = parts
                .iter()
                .filter_map(|part| part.as_str().map(str::trim))
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            if joined.is_empty() {
                None
            } else {
                Some(joined)
            }
        }
        _ => None,
    }
}

/// Merge tool argument JSON summaries. Object keys from `incoming` win; non-JSON
/// strings fall back to last-write-wins (preserves prior string when incoming empty).
pub(crate) fn merge_tool_arguments_summary(existing: Option<&str>, incoming: &str) -> String {
    let incoming = incoming.trim();
    if incoming.is_empty() {
        return existing.unwrap_or("").to_string();
    }
    let Some(existing) = existing.map(str::trim).filter(|text| !text.is_empty()) else {
        return incoming.to_string();
    };
    let Ok(Value::Object(mut base)) = serde_json::from_str::<Value>(existing) else {
        return incoming.to_string();
    };
    let Ok(Value::Object(patch)) = serde_json::from_str::<Value>(incoming) else {
        return incoming.to_string();
    };
    for (key, value) in patch {
        base.insert(key, value);
    }
    serde_json::to_string(&Value::Object(base)).unwrap_or_else(|_| incoming.to_string())
}

pub(crate) fn terminal_evidence_from_value(
    value: &Value,
    fallback_text: Option<String>,
    force_failed: bool,
) -> TerminalEvidence {
    let outcome = if force_failed {
        OutcomeStatus::Failed
    } else {
        completion_outcome(Some(value))
    };
    TerminalEvidence {
        outcome,
        error_code: value_string_by_aliases(
            Some(value),
            &[
                "errorCode",
                "error_code",
                "code",
                "reasonCode",
                "reason_code",
            ],
        )
        .or_else(|| {
            value.get("error").and_then(|error| {
                value_string_by_aliases(
                    Some(error),
                    &[
                        "errorCode",
                        "error_code",
                        "code",
                        "reasonCode",
                        "reason_code",
                    ],
                )
            })
        }),
        error_message: value_string_by_aliases(
            Some(value),
            &["errorMessage", "error_message", "message"],
        )
        .or_else(|| {
            value
                .get("error")
                .and_then(|error| value_string_by_aliases(Some(error), &["message"]))
        }),
        stop_reason: value_string_by_aliases(Some(value), &["stopReason", "stop_reason", "reason"]),
        fallback_text,
        artifacts: extract_explicit_artifact_refs(value),
        provider_private_refs: deserialize_vec_by_aliases(
            Some(value),
            &["providerPrivateRefs", "provider_private_refs"],
        ),
        omissions: deserialize_vec_by_aliases(Some(value), &["omissions"]),
    }
}
