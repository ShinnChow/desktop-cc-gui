use super::*;

#[cfg(test)]
pub(crate) fn parse_codex_session_summary(
    path: &Path,
    workspace_path: Option<&Path>,
) -> Result<Option<LocalUsageSessionSummary>, String> {
    parse_codex_session_summary_with_mode(path, workspace_path, CodexSessionParseMode::Full)
}

pub(crate) fn parse_codex_session_summary_with_mode(
    path: &Path,
    workspace_path: Option<&Path>,
    parse_mode: CodexSessionParseMode,
) -> Result<Option<LocalUsageSessionSummary>, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return Ok(None),
    };
    let file_modified_at_ms = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified_at| modified_at.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64);
    let reader: Box<dyn BufRead> = match parse_mode {
        CodexSessionParseMode::Full => Box::new(BufReader::new(file)),
        CodexSessionParseMode::ThreadPreview => {
            Box::new(BufReader::new(file).take(CODEX_THREAD_PREVIEW_MAX_BYTES))
        }
    };
    let mut usage = LocalUsageUsageData::default();
    let mut summary: Option<String> = None;
    let mut model: Option<String> = None;
    let mut source: Option<String> = None;
    let mut provider: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut canonical_session_id: Option<String> = None;
    let mut subagent_metadata: Option<CodexSubagentSessionMetadata> = None;
    let mut latest_timestamp = 0_i64;
    let mut previous_totals: Option<UsageTotals> = None;
    let mut match_known = workspace_path.is_none();
    let mut matches_workspace = workspace_path.is_none();
    let mut saw_session_signal = false;
    let mut modified_lines = 0_i64;
    let mut max_diff_stat_lines = 0_i64;
    let mut pending_apply_patch_lines: HashMap<String, i64> = HashMap::new();
    let mut response_item_user_summary: Option<String> = None;

    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => continue,
        };
        if line.len() > 512_000 {
            continue;
        }

        let value = match serde_json::from_str::<Value>(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        latest_timestamp = latest_timestamp.max(read_timestamp_ms(&value).unwrap_or(0));

        let entry_type = value
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("");

        if entry_type == "response_item" {
            if let Some(payload) = value.get("payload").and_then(|payload| payload.as_object()) {
                let payload_type = payload
                    .get("type")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");

                if payload_type == "message" {
                    let role = payload
                        .get("role")
                        .and_then(|value| value.as_str())
                        .unwrap_or("");
                    if role == "user" {
                        saw_session_signal = true;
                        if response_item_user_summary.is_none() {
                            if let Some(message) = extract_codex_message_text(payload) {
                                if is_codex_session_title_candidate(&message) {
                                    response_item_user_summary = truncate_summary(&message);
                                }
                            }
                        }
                    }
                } else if payload_type == "custom_tool_call" {
                    let tool_name = payload
                        .get("name")
                        .and_then(|value| value.as_str())
                        .unwrap_or("");
                    if tool_name == "apply_patch" {
                        let call_id = payload
                            .get("call_id")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string();
                        if !call_id.is_empty() {
                            let patch_input = payload
                                .get("input")
                                .and_then(|value| value.as_str())
                                .unwrap_or("");
                            pending_apply_patch_lines
                                .insert(call_id, count_apply_patch_changed_lines(patch_input));
                            saw_session_signal = true;
                        }
                    }
                } else if payload_type == "custom_tool_call_output" {
                    let call_id = payload
                        .get("call_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("");
                    if let Some(pending_lines) = pending_apply_patch_lines.remove(call_id) {
                        let output = payload
                            .get("output")
                            .map(stringify_tool_output_value)
                            .unwrap_or_default();
                        if is_successful_apply_patch_output(&output) {
                            modified_lines += pending_lines.max(0);
                        }
                    }
                } else if payload_type == "function_call_output" {
                    let output = payload
                        .get("output")
                        .map(extract_tool_output_text)
                        .unwrap_or_default();
                    if let Some(lines) = parse_changed_lines_from_git_diff_stat_output(&output) {
                        max_diff_stat_lines = max_diff_stat_lines.max(lines.max(0));
                    }
                }
            }
            continue;
        }

        if entry_type == "session_meta" || entry_type == "turn_context" {
            saw_session_signal = true;
            if canonical_session_id.is_none() {
                canonical_session_id = extract_session_id_from_session_value(&value);
            }
            if subagent_metadata.is_none() {
                subagent_metadata = extract_codex_subagent_metadata_from_session_value(&value);
            }
            if let Some(detected_cwd) = extract_cwd(&value) {
                if cwd.is_none() {
                    cwd = Some(detected_cwd.clone());
                }
                if let Some(filter) = workspace_path {
                    matches_workspace = path_matches_workspace(&detected_cwd, filter);
                    match_known = true;
                    if !matches_workspace {
                        break;
                    }
                }
            }
            let (detected_source, detected_provider) =
                extract_source_provider_from_session_value(&value);
            if source.is_none() {
                source = detected_source;
            }
            if provider.is_none() {
                provider = detected_provider;
            }
        }

        if entry_type == "turn_context" {
            if model.is_none() {
                model = extract_model_from_turn_context(&value);
            }
            continue;
        }

        if !matches_workspace {
            if match_known {
                break;
            }
            continue;
        }

        if workspace_path.is_some() && !match_known {
            continue;
        }

        if summary.is_none() && entry_type == "event_msg" {
            if let Some(payload) = value.get("payload").and_then(|payload| payload.as_object()) {
                let payload_type = payload
                    .get("type")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                if matches!(payload_type, "user_message" | "userMessage") {
                    saw_session_signal = true;
                    if let Some(message) = payload.get("message").and_then(|value| value.as_str()) {
                        if is_codex_session_title_candidate(message) {
                            summary = truncate_summary(message);
                        }
                    }
                }
            }
        }

        if !(entry_type == "event_msg" || entry_type.is_empty()) {
            continue;
        }
        let payload = value.get("payload").and_then(|value| value.as_object());
        let payload_type = payload
            .and_then(|payload| payload.get("type"))
            .and_then(|value| value.as_str());
        if payload_type != Some("token_count") {
            continue;
        }
        saw_session_signal = true;

        let info = payload
            .and_then(|payload| payload.get("info"))
            .and_then(|value| value.as_object());
        let (input, cached, output, used_total) = if let Some(info) = info {
            if let Some(total) = find_usage_map(info, &["total_token_usage", "totalTokenUsage"]) {
                (
                    read_i64(total, &["input_tokens", "inputTokens"]),
                    read_i64(
                        total,
                        &[
                            "cached_input_tokens",
                            "cache_read_input_tokens",
                            "cachedInputTokens",
                            "cacheReadInputTokens",
                        ],
                    ),
                    read_i64(total, &["output_tokens", "outputTokens"]),
                    true,
                )
            } else if let Some(last) = find_usage_map(info, &["last_token_usage", "lastTokenUsage"])
            {
                (
                    read_i64(last, &["input_tokens", "inputTokens"]),
                    read_i64(
                        last,
                        &[
                            "cached_input_tokens",
                            "cache_read_input_tokens",
                            "cachedInputTokens",
                            "cacheReadInputTokens",
                        ],
                    ),
                    read_i64(last, &["output_tokens", "outputTokens"]),
                    false,
                )
            } else {
                continue;
            }
        } else {
            continue;
        };

        let mut delta = UsageTotals {
            input,
            cached,
            output,
        };
        if used_total {
            let prev = previous_totals.unwrap_or_default();
            delta = UsageTotals {
                input: (input - prev.input).max(0),
                cached: (cached - prev.cached).max(0),
                output: (output - prev.output).max(0),
            };
            previous_totals = Some(UsageTotals {
                input,
                cached,
                output,
            });
        } else {
            let mut next = previous_totals.unwrap_or_default();
            next.input += delta.input;
            next.cached += delta.cached;
            next.output += delta.output;
            previous_totals = Some(next);
        }

        if delta.input == 0 && delta.cached == 0 && delta.output == 0 {
            continue;
        }

        usage.input_tokens += delta.input.max(0);
        usage.output_tokens += delta.output.max(0);
        usage.cache_read_tokens += delta.cached.max(0);
        if model.is_none() {
            model = extract_model_from_token_count(&value);
        }
    }

    if workspace_path.is_some() && !matches_workspace {
        return Ok(None);
    }

    usage.total_tokens = usage.input_tokens
        + usage.output_tokens
        + usage.cache_write_tokens
        + usage.cache_read_tokens;
    if modified_lines == 0 && max_diff_stat_lines > 0 {
        modified_lines = max_diff_stat_lines;
    }

    if !saw_session_signal {
        return Ok(None);
    }

    if summary.is_none()
        && response_item_user_summary.is_none()
        && usage.total_tokens == 0
        && modified_lines == 0
        && canonical_session_id.is_none()
        && source.is_none()
        && provider.is_none()
    {
        return Ok(None);
    }

    let file_stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let session_id = canonical_session_id.unwrap_or_else(|| file_stem.clone());
    let mut session_id_aliases = Vec::new();
    if !file_stem.is_empty() && file_stem != session_id {
        session_id_aliases.push(file_stem);
    }
    let model = model.unwrap_or_else(|| "gpt-5.1".to_string());
    let cost = calculate_usage_cost(&usage, codex_cost_rates());
    let timestamp = if parse_mode == CodexSessionParseMode::ThreadPreview {
        file_modified_at_ms
            .filter(|timestamp| *timestamp > 0)
            .unwrap_or(latest_timestamp)
    } else if latest_timestamp > 0 {
        latest_timestamp
    } else {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    };

    let parent_session_id = subagent_metadata
        .as_ref()
        .map(|metadata| metadata.parent_session_id.clone());
    let summary = subagent_metadata
        .as_ref()
        .and_then(codex_subagent_display_title)
        .or(summary)
        .or(response_item_user_summary);
    let provider_profile_id = infer_managed_codex_provider_profile_id_from_session_path(path);
    let provider_profile_source = provider_profile_id
        .as_ref()
        .map(|_| CODEX_PROVIDER_PROFILE_SOURCE_MANAGED.to_string());
    let provider_availability = provider_profile_id
        .as_ref()
        .map(|_| CODEX_PROVIDER_PROFILE_AVAILABILITY_UNKNOWN.to_string());
    let physical_path = Some(path.to_string_lossy().to_string());

    Ok(Some(LocalUsageSessionSummary {
        session_id,
        session_id_aliases,
        parent_session_id,
        timestamp,
        cwd,
        model,
        usage,
        cost,
        summary,
        native_title: None,
        source,
        provider,
        provider_profile_id,
        provider_profile_source,
        provider_profile_name: None,
        provider_availability,
        physical_path,
        file_size_bytes: fs::metadata(path).ok().map(|metadata| metadata.len()),
        modified_lines,
    }))
}

pub(crate) fn infer_managed_codex_provider_profile_id_from_session_path(
    path: &Path,
) -> Option<String> {
    for ancestor in path.ancestors() {
        let segment = ancestor.file_name().and_then(|value| value.to_str())?;
        if segment != "sessions" && segment != "archived_sessions" {
            continue;
        }
        let provider_home = ancestor.parent()?;
        let provider_homes_root = provider_home.parent()?;
        if provider_homes_root
            .file_name()
            .and_then(|value| value.to_str())
            != Some("codex-provider-homes")
        {
            continue;
        }
        let provider_id = provider_home
            .file_name()
            .and_then(|value| value.to_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())?;
        return Some(provider_id.to_string());
    }
    None
}

