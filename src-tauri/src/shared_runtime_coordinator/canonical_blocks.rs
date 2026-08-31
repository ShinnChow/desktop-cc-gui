//! Canonical block 构造/转换：assistant/reasoning block 合并、tool result upsert、
//! artifact / private ref / omission 提取与 JSON alias 解析。

use super::*;

pub(crate) fn push_assistant_block(blocks: &mut Vec<CanonicalBlock>, next: CanonicalBlock) {
    match (blocks.last_mut(), next) {
        (Some(CanonicalBlock::Text { text }), CanonicalBlock::Text { text: delta }) => {
            text.push_str(&delta);
        }
        (Some(CanonicalBlock::Reasoning { text }), CanonicalBlock::Reasoning { text: delta }) => {
            text.push_str(&delta);
        }
        (_, next) => blocks.push(next),
    }
}

pub(crate) fn canonical_block_text(block: &CanonicalBlock) -> (&'static str, &str) {
    match block {
        CanonicalBlock::Text { text } => ("text", text),
        CanonicalBlock::Reasoning { text } => ("reasoning", text),
        _ => ("other", ""),
    }
}

pub(crate) fn matching_block_text(blocks: &[CanonicalBlock], kind: &str) -> String {
    blocks
        .iter()
        .filter_map(|block| {
            let (block_kind, text) = canonical_block_text(block);
            (block_kind == kind).then_some(text)
        })
        .collect()
}

pub(crate) fn is_full_claude_observation(text: &str) -> bool {
    text.chars()
        .filter(|character| !character.is_whitespace())
        .count()
        >= CLAUDE_FULL_OBSERVATION_MIN_CHARS
}

/// Claude provider adapters may expose a growing full snapshot on more than one protocol
/// surface. This merge is intentionally scoped to the Shared accumulator: Native Claude keeps
/// its existing reducer normalization and Codex keeps delta append semantics.
pub(crate) fn merge_claude_full_observation(blocks: &mut Vec<CanonicalBlock>, next: CanonicalBlock) {
    let (kind, incoming) = canonical_block_text(&next);
    if kind == "other" || incoming.trim().is_empty() {
        push_assistant_block(blocks, next);
        return;
    }

    let existing = matching_block_text(blocks, kind);
    if existing.is_empty() || !is_full_claude_observation(&existing) {
        push_assistant_block(blocks, next);
        return;
    }
    if incoming == existing || existing.starts_with(incoming) {
        return;
    }
    if let Some(suffix) = incoming.strip_prefix(&existing) {
        let replay_trimmed = suffix.trim_start();
        if let Some(after_replay) = replay_trimmed.strip_prefix(&existing) {
            if !after_replay.is_empty() {
                let replay_free = match kind {
                    "text" => CanonicalBlock::Text {
                        text: after_replay.to_string(),
                    },
                    "reasoning" => CanonicalBlock::Reasoning {
                        text: after_replay.to_string(),
                    },
                    _ => unreachable!("canonical block kind checked above"),
                };
                push_assistant_block(blocks, replay_free);
            }
            return;
        }
        if !suffix.is_empty() {
            let incremental_suffix = match kind {
                "text" => CanonicalBlock::Text {
                    text: suffix.to_string(),
                },
                "reasoning" => CanonicalBlock::Reasoning {
                    text: suffix.to_string(),
                },
                _ => unreachable!("canonical block kind checked above"),
            };
            push_assistant_block(blocks, incremental_suffix);
        }
        return;
    }

    push_assistant_block(blocks, next);
}

pub(crate) fn merge_claude_complete_assistant_text(blocks: &mut Vec<CanonicalBlock>, complete_text: String) {
    let existing_text = matching_block_text(blocks, "text");
    if is_full_claude_observation(&existing_text) {
        if complete_text == existing_text || existing_text.starts_with(&complete_text) {
            return;
        }
        if let Some(suffix) = complete_text.strip_prefix(&existing_text) {
            if suffix.trim_start().starts_with(&existing_text) {
                return;
            }
        }
    }
    merge_complete_assistant_text(blocks, complete_text);
}

/// Snapshot/terminal text 是累计完成证据。只做单调补全；无前缀关系时保留独立
/// Text block，禁止用猜测覆盖已观察到的 streamed content。
pub(crate) fn merge_complete_assistant_text(blocks: &mut Vec<CanonicalBlock>, complete_text: String) {
    if complete_text.trim().is_empty() {
        return;
    }

    let existing_text = blocks
        .iter()
        .filter_map(|block| match block {
            CanonicalBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<String>();
    if existing_text.is_empty() {
        blocks.push(CanonicalBlock::Text {
            text: complete_text,
        });
        return;
    }
    if complete_text == existing_text || existing_text.starts_with(&complete_text) {
        return;
    }
    if let Some(suffix) = complete_text.strip_prefix(&existing_text) {
        if let Some(CanonicalBlock::Text { text }) = blocks
            .iter_mut()
            .rev()
            .find(|block| matches!(block, CanonicalBlock::Text { .. }))
        {
            text.push_str(suffix);
        }
        return;
    }
    if blocks
        .iter()
        .any(|block| matches!(block, CanonicalBlock::Text { text } if text == &complete_text))
    {
        return;
    }

    blocks.push(CanonicalBlock::Text {
        text: complete_text,
    });
}

pub(crate) fn upsert_tool_result(results: &mut Vec<RuntimeToolResult>, result: RuntimeToolResult) {
    if let Some(existing) = results
        .iter_mut()
        .find(|existing| existing.tool_call_id == result.tool_call_id)
    {
        *existing = result;
    } else {
        results.push(result);
    }
}

pub(crate) fn stringify_json_value(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| serde_json::to_string(value).unwrap_or_default())
}

pub(crate) fn extract_explicit_artifact_refs(value: &Value) -> Vec<ArtifactRef> {
    fn walk(value: &Value, refs: &mut Vec<ArtifactRef>) {
        match value {
            Value::Array(items) => items.iter().for_each(|item| walk(item, refs)),
            Value::Object(object) => {
                for (key, child) in object {
                    if matches!(
                        key.as_str(),
                        "artifactRef" | "artifact_ref" | "artifactRefs" | "artifact_refs"
                    ) {
                        match child {
                            Value::Array(items) => {
                                for item in items {
                                    if let Ok(artifact) =
                                        serde_json::from_value::<ArtifactRef>(item.clone())
                                    {
                                        refs.push(artifact);
                                    }
                                }
                            }
                            _ => {
                                if let Ok(artifact) =
                                    serde_json::from_value::<ArtifactRef>(child.clone())
                                {
                                    refs.push(artifact);
                                }
                            }
                        }
                    } else {
                        walk(child, refs);
                    }
                }
            }
            _ => {}
        }
    }

    let mut refs = Vec::new();
    walk(value, &mut refs);
    let mut unique = Vec::new();
    extend_unique_artifacts(&mut unique, refs);
    unique
}

pub(crate) fn extract_claude_replay_echo(data: &Value) -> Option<String> {
    let is_replay = data
        .get("isReplay")
        .or_else(|| data.get("is_replay"))
        .and_then(Value::as_bool)
        == Some(true);
    if !is_replay {
        return None;
    }
    fn collect_text(value: &Value, output: &mut String) {
        match value {
            Value::String(text) => output.push_str(text),
            Value::Array(items) => {
                for item in items {
                    collect_text(item, output);
                }
            }
            Value::Object(object) => {
                for key in ["content", "text", "message"] {
                    if let Some(value) = object.get(key) {
                        collect_text(value, output);
                    }
                }
            }
            _ => {}
        }
    }
    let mut echo = String::new();
    collect_text(data.get("message").unwrap_or(data), &mut echo);
    echo.contains("MOSSX_CONTEXT_PACKAGE:")
        .then_some(echo)
        .filter(|value| !value.is_empty())
}

pub(crate) fn extend_unique_artifacts(target: &mut Vec<ArtifactRef>, values: Vec<ArtifactRef>) {
    for value in values {
        if !target.iter().any(|existing| {
            existing.artifact_id == value.artifact_id && existing.sha256 == value.sha256
        }) {
            target.push(value);
        }
    }
}

pub(crate) fn extend_unique_private_refs(
    target: &mut Vec<ProviderPrivateRef>,
    values: Vec<ProviderPrivateRef>,
) {
    for value in values {
        if !target
            .iter()
            .any(|existing| existing.ref_id == value.ref_id)
        {
            target.push(value);
        }
    }
}

pub(crate) fn extend_unique_omissions(target: &mut Vec<CanonicalOmission>, values: Vec<CanonicalOmission>) {
    for value in values {
        if !target.iter().any(|existing| {
            existing.category == value.category
                && existing.reason == value.reason
                && existing.retrievable_ref == value.retrievable_ref
        }) {
            target.push(value);
        }
    }
}

pub(crate) fn deserialize_vec_by_aliases<T: serde::de::DeserializeOwned>(
    value: Option<&Value>,
    aliases: &[&str],
) -> Vec<T> {
    let Some(value) = value else {
        return Vec::new();
    };
    for alias in aliases {
        if let Some(candidate) = value.get(*alias) {
            if let Ok(values) = serde_json::from_value::<Vec<T>>(candidate.clone()) {
                return values;
            }
        }
    }
    Vec::new()
}

pub(crate) fn completion_outcome(value: Option<&Value>) -> OutcomeStatus {
    let status =
        value_string_by_aliases(value, &["status", "outcome", "stopReason", "stop_reason"])
            .or_else(|| {
                value.and_then(|root| {
                    ["turn", "result"].iter().find_map(|key| {
                        root.get(*key).and_then(|nested| {
                            value_string_by_aliases(
                                Some(nested),
                                &["status", "outcome", "stopReason", "stop_reason"],
                            )
                        })
                    })
                })
            })
            .unwrap_or_default()
            .to_ascii_lowercase();
    match status.as_str() {
        "cancelled" | "canceled" | "interrupted" | "aborted" => OutcomeStatus::Cancelled,
        "failed" | "error" => OutcomeStatus::Failed,
        "replaced" => OutcomeStatus::Replaced,
        _ => OutcomeStatus::Completed,
    }
}

pub(crate) fn value_by_aliases<'a>(value: &'a Value, aliases: &[&str]) -> Option<&'a Value> {
    aliases.iter().find_map(|alias| value.get(*alias))
}

pub(crate) fn value_string_by_aliases(value: Option<&Value>, aliases: &[&str]) -> Option<String> {
    let value = value?;
    value_by_aliases(value, aliases)
        .and_then(|candidate| match candidate {
            Value::String(text) => Some(text.clone()),
            Value::Object(_) | Value::Array(_) => serde_json::to_string(candidate).ok(),
            Value::Null => None,
            other => Some(other.to_string()),
        })
        .filter(|text| !text.trim().is_empty())
}

pub(crate) fn is_assistant_or_reasoning_item(item: &Value) -> bool {
    let item_type = value_string_by_aliases(Some(item), &["type", "kind"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        item_type.as_str(),
        "agentmessage" | "agent_message" | "assistantmessage" | "assistant_message" | "reasoning"
    )
}

pub(crate) fn is_tool_item_type(item_type: &str) -> bool {
    matches!(
        item_type.to_ascii_lowercase().as_str(),
        "commandexecution"
            | "command_execution"
            | "filechange"
            | "file_change"
            | "mcptoolcall"
            | "mcp_tool_call"
            | "toolcall"
            | "tool_call"
            | "dynamictoolcall"
            | "dynamic_tool_call"
            // Codex Responses often emits apply_patch as custom_tool_call (not fileChange).
            | "customtoolcall"
            | "custom_tool_call"
            | "function_call"
            | "functioncall"
            | "apply_patch"
            | "applypatch"
    )
}
