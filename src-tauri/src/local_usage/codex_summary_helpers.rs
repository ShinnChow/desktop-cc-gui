use super::*;

pub(crate) fn count_apply_patch_changed_lines(input: &str) -> i64 {
    let mut changed_lines = 0_i64;
    for raw_line in input.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.starts_with('+') {
            if is_unified_diff_file_header(line, "+++") {
                continue;
            }
            changed_lines += 1;
            continue;
        }
        if line.starts_with('-') {
            if is_unified_diff_file_header(line, "---") {
                continue;
            }
            changed_lines += 1;
        }
    }
    changed_lines
}

fn is_unified_diff_file_header(line: &str, marker: &str) -> bool {
    if !line.starts_with(marker) {
        return false;
    }
    line.as_bytes()
        .get(marker.len())
        .map(|next| *next == b' ' || *next == b'\t')
        .unwrap_or(false)
}

pub(crate) fn is_successful_apply_patch_output(raw_output: &str) -> bool {
    fn read_exit_code(value: &Value) -> Option<i64> {
        value
            .as_i64()
            .or_else(|| value.as_f64().map(|value| value as i64))
            .or_else(|| {
                value
                    .as_str()
                    .and_then(|text| text.trim().parse::<i64>().ok())
            })
    }

    let trimmed = raw_output.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lowered = trimmed.to_ascii_lowercase();
    if lowered.contains("verification failed") {
        return false;
    }

    if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
        let exit_code = parsed
            .get("metadata")
            .and_then(|value| value.get("exit_code").or_else(|| value.get("exitCode")))
            .and_then(read_exit_code)
            .or_else(|| parsed.get("exitCode").and_then(read_exit_code))
            .unwrap_or(-1);
        if exit_code == 0 {
            return true;
        }
        if let Some(output_value) = parsed.get("output") {
            let output_text = extract_tool_output_text(output_value);
            if contains_apply_patch_success_marker(&output_text) {
                return true;
            }
        }
        return false;
    }

    contains_apply_patch_success_marker(trimmed)
}

pub(crate) fn parse_changed_lines_from_git_diff_stat_output(output: &str) -> Option<i64> {
    let mut changed_lines_from_summary = None;
    let mut changed_lines_from_stats = 0_i64;
    let mut saw_stat_line = false;

    for line in output.lines() {
        let normalized = line.trim();
        if normalized.is_empty() {
            continue;
        }

        let normalized_lower = normalized.to_ascii_lowercase();
        if normalized_lower.contains("file changed") || normalized_lower.contains("files changed") {
            let insertions = read_number_before_keyword(normalized, "insertion").unwrap_or(0);
            let deletions = read_number_before_keyword(normalized, "deletion").unwrap_or(0);
            changed_lines_from_summary = Some(insertions + deletions);
        }

        if let Some(changed) = parse_diff_stat_line_changed_count(normalized) {
            saw_stat_line = true;
            changed_lines_from_stats += changed.max(0);
        }
    }

    changed_lines_from_summary.or({
        if saw_stat_line {
            Some(changed_lines_from_stats)
        } else {
            None
        }
    })
}

fn parse_diff_stat_line_changed_count(line: &str) -> Option<i64> {
    let (path_segment, stats_segment) = line.split_once('|')?;
    if path_segment.trim().is_empty() {
        return None;
    }

    let numeric_prefix: String = stats_segment
        .trim_start()
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect();
    if numeric_prefix.is_empty() {
        return None;
    }

    numeric_prefix.parse::<i64>().ok()
}

fn read_number_before_keyword(line: &str, keyword: &str) -> Option<i64> {
    let lower = line.to_ascii_lowercase();
    let keyword_index = lower.find(keyword)?;
    let prefix = &line[..keyword_index];
    prefix
        .split(|ch: char| !ch.is_ascii_digit())
        .rfind(|segment| !segment.is_empty())
        .and_then(|segment| segment.parse::<i64>().ok())
}

fn contains_apply_patch_success_marker(output: &str) -> bool {
    let lowered = output.to_ascii_lowercase();
    lowered.contains("success. updated the following files:")
        || lowered.contains("process exited with code 0")
        || lowered.contains("exit code: 0")
}

pub(crate) fn stringify_tool_output_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

pub(crate) fn extract_tool_output_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(items) => {
            let joined = items
                .iter()
                .map(extract_tool_output_text)
                .filter(|item| !item.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            if joined.is_empty() {
                serde_json::to_string(value).unwrap_or_default()
            } else {
                joined
            }
        }
        Value::Object(map) => {
            for key in ["output", "stdout", "stderr", "text", "message", "result"] {
                if let Some(next) = map.get(key) {
                    let nested = extract_tool_output_text(next);
                    if !nested.trim().is_empty() {
                        return nested;
                    }
                }
            }
            serde_json::to_string(value).unwrap_or_default()
        }
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn normalize_non_empty_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

#[derive(Debug, Clone)]
pub(crate) struct CodexSubagentSessionMetadata {
    pub(crate) parent_session_id: String,
    pub(crate) agent_nickname: Option<String>,
    pub(crate) agent_path: Option<String>,
}

pub(crate) fn extract_codex_subagent_metadata_from_session_value(
    value: &Value,
) -> Option<CodexSubagentSessionMetadata> {
    let root = value.as_object()?;
    let payload = root.get("payload").and_then(Value::as_object);
    let session_meta = payload
        .and_then(|payload| payload.get("session_meta"))
        .and_then(Value::as_object)
        .or_else(|| {
            payload
                .and_then(|payload| payload.get("sessionMeta"))
                .and_then(Value::as_object)
        });

    for object in [Some(root), payload, session_meta].into_iter().flatten() {
        if let Some(metadata) = extract_codex_subagent_metadata_from_object(object) {
            return Some(metadata);
        }
    }

    None
}

fn extract_codex_subagent_metadata_from_object(
    object: &serde_json::Map<String, Value>,
) -> Option<CodexSubagentSessionMetadata> {
    if let Some(source) = object
        .get("source")
        .or_else(|| object.get("sessionSource"))
        .and_then(Value::as_object)
    {
        if let Some(subagent) = source
            .get("subagent")
            .or_else(|| source.get("subAgent"))
            .and_then(Value::as_object)
        {
            if let Some(thread_spawn) = subagent
                .get("thread_spawn")
                .or_else(|| subagent.get("threadSpawn"))
                .and_then(Value::as_object)
            {
                if let Some(metadata) = read_codex_subagent_metadata(thread_spawn) {
                    return Some(metadata);
                }
            }
        }
    }

    let thread_source = object
        .get("thread_source")
        .or_else(|| object.get("threadSource"))
        .and_then(Value::as_str)
        .map(str::trim)
        .map(|value| value.eq_ignore_ascii_case("subagent"))
        .unwrap_or(false);
    if thread_source {
        if let Some(metadata) = read_codex_subagent_metadata(object) {
            return Some(metadata);
        }
    }
    None
}

fn read_codex_subagent_metadata(
    object: &serde_json::Map<String, Value>,
) -> Option<CodexSubagentSessionMetadata> {
    let parent_session_id =
        read_string_from_object(object, &["parent_thread_id", "parentThreadId"])?;
    Some(CodexSubagentSessionMetadata {
        parent_session_id,
        agent_nickname: read_string_from_object(object, &["agent_nickname", "agentNickname"]),
        agent_path: read_string_from_object(object, &["agent_path", "agentPath"]),
    })
}

pub(crate) fn codex_subagent_display_title(metadata: &CodexSubagentSessionMetadata) -> Option<String> {
    metadata.agent_nickname.clone().or_else(|| {
        metadata
            .agent_path
            .as_deref()
            .and_then(portable_path_basename)
    })
}

fn portable_path_basename(path: &str) -> Option<String> {
    let trimmed = path.trim().trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return None;
    }
    trimmed
        .rsplit(['/', '\\'])
        .find_map(|segment| normalize_non_empty_string(Some(segment)))
}

pub(crate) fn extract_session_id_from_session_value(value: &Value) -> Option<String> {
    let root = value.as_object()?;
    let payload = root.get("payload").and_then(Value::as_object);
    let session_meta = payload
        .and_then(|payload| payload.get("session_meta"))
        .and_then(Value::as_object)
        .or_else(|| {
            payload
                .and_then(|payload| payload.get("sessionMeta"))
                .and_then(Value::as_object)
        });

    normalize_non_empty_string(
        root.get("session_id")
            .or_else(|| root.get("sessionId"))
            .or_else(|| root.get("id"))
            .and_then(Value::as_str),
    )
    .or_else(|| {
        payload.and_then(|item| read_string_from_object(item, &["id", "session_id", "sessionId"]))
    })
    .or_else(|| {
        session_meta
            .and_then(|item| read_string_from_object(item, &["id", "session_id", "sessionId"]))
    })
}

pub(crate) fn read_string_from_object(
    object: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<String> {
    for key in keys {
        if let Some(found) = normalize_non_empty_string(object.get(*key).and_then(Value::as_str)) {
            return Some(found);
        }
    }
    None
}

fn normalize_originator_source(value: Option<String>) -> Option<String> {
    let value = value?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower == "ccgui" || lower == "codemoss" || lower == "mossx" {
        return Some("ccgui".to_string());
    }
    if lower == "codex_cli_rs" {
        return Some("cli".to_string());
    }
    if lower.contains("codex desktop") {
        return Some("desktop".to_string());
    }
    Some(trimmed.to_string())
}

pub(crate) fn extract_source_provider_from_session_value(value: &Value) -> (Option<String>, Option<String>) {
    let Some(root) = value.as_object() else {
        return (None, None);
    };
    let payload = root.get("payload").and_then(Value::as_object);
    let session_meta = payload
        .and_then(|payload| payload.get("session_meta"))
        .and_then(Value::as_object)
        .or_else(|| {
            payload
                .and_then(|payload| payload.get("sessionMeta"))
                .and_then(Value::as_object)
        });
    let originator = normalize_originator_source(
        read_string_from_object(root, &["originator", "origin", "client", "app"])
            .or_else(|| {
                payload.and_then(|item| read_string_from_object(item, &["originator", "origin"]))
            })
            .or_else(|| {
                session_meta
                    .and_then(|item| read_string_from_object(item, &["originator", "origin"]))
            }),
    );

    let source = read_string_from_object(root, &["source", "sessionSource"])
        .or_else(|| {
            payload.and_then(|item| read_string_from_object(item, &["source", "sessionSource"]))
        })
        .or_else(|| {
            session_meta
                .and_then(|item| read_string_from_object(item, &["source", "sessionSource"]))
        });
    let source = match (source, originator) {
        (Some(source), Some(originator))
            if source.eq_ignore_ascii_case("vscode")
                && !originator.eq_ignore_ascii_case("vscode") =>
        {
            Some(originator)
        }
        (None, Some(originator)) => Some(originator),
        (source, _) => source,
    };

    let provider = read_string_from_object(
        root,
        &["provider", "providerId", "model_provider", "modelProvider"],
    )
    .or_else(|| {
        payload.and_then(|item| {
            read_string_from_object(
                item,
                &["provider", "providerId", "model_provider", "modelProvider"],
            )
        })
    })
    .or_else(|| {
        session_meta.and_then(|item| {
            read_string_from_object(
                item,
                &["provider", "providerId", "model_provider", "modelProvider"],
            )
        })
    });

    (source, provider)
}

pub(crate) fn truncate_summary(text: &str) -> Option<String> {
    let cleaned = text.replace('\n', " ").trim().to_string();
    if cleaned.is_empty() {
        return None;
    }
    let limit = 45;
    let truncated = if cleaned.chars().count() > limit {
        format!("{}...", cleaned.chars().take(limit).collect::<String>())
    } else {
        cleaned
    };
    Some(truncated)
}

pub(crate) fn is_codex_session_title_candidate(text: &str) -> bool {
    let trimmed = text.trim_start();
    if trimmed.is_empty() {
        return false;
    }
    let lowered = trimmed.to_ascii_lowercase();
    if lowered.starts_with("# agents.md instructions for ") && trimmed.contains("<INSTRUCTIONS>") {
        return false;
    }
    if lowered.starts_with("<session-context>")
        || lowered.starts_with("<environment_context>")
        || lowered.starts_with("omx native sessionstart detected.")
    {
        return false;
    }
    true
}

pub(crate) fn is_codex_background_helper_text(value: &str) -> bool {
    let preview = value.trim();
    if preview.is_empty() {
        return false;
    }
    if CODEX_BACKGROUND_HELPER_PROMPT_PREFIXES
        .iter()
        .any(|prefix| preview.starts_with(prefix))
    {
        return true;
    }
    let lower = preview.to_ascii_lowercase();
    let starts_with_memory_agent_header =
        lower.starts_with("## memory writing agent:") || lower.starts_with("memory writing agent:");
    starts_with_memory_agent_header
        && (lower.contains("consolidation") || lower.contains("phase 2"))
}

/// Native title or first user preview Codex would show in the sidebar.
pub(crate) fn peek_codex_session_titles(
    path: &Path,
) -> Result<Option<(Option<String>, Option<String>)>, String> {
    Ok(
        parse_codex_session_summary_with_mode(path, None, CodexSessionParseMode::ThreadPreview)?
            .map(|summary| (summary.native_title, summary.summary)),
    )
}

pub(crate) fn extract_codex_message_text(payload: &serde_json::Map<String, Value>) -> Option<String> {
    if let Some(text) = payload.get("content").and_then(Value::as_str) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    let mut parts: Vec<String> = Vec::new();
    if let Some(content) = payload.get("content").and_then(Value::as_array) {
        for item in content {
            let Some(record) = item.as_object() else {
                continue;
            };
            for key in ["text", "value", "content"] {
                if let Some(text) = record.get(key).and_then(Value::as_str) {
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    parts.push(trimmed.to_string());
                    break;
                }
            }
        }
    }
    if !parts.is_empty() {
        return Some(parts.join("\n\n"));
    }
    for key in ["text", "message"] {
        if let Some(text) = payload.get(key).and_then(Value::as_str) {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }
            return Some(trimmed.to_string());
        }
    }
    None
}

