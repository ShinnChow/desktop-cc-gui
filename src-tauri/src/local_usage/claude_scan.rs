use super::*;

/// Get Claude Code projects directory (~/.claude/projects/)
fn claude_projects_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".claude").join("projects"))
}

/// Scan Claude Code session files for usage statistics.
/// Claude Code stores sessions in ~/.claude/projects/{encoded-path}/{session-id}.jsonl
pub(crate) fn scan_claude_projects(
    day_keys: &[String],
    daily: &mut HashMap<String, DailyTotals>,
    model_totals: &mut HashMap<String, i64>,
    workspace_path: Option<&Path>,
) -> Result<(), String> {
    let projects_dir = match claude_projects_dir() {
        Some(dir) if dir.exists() => dir,
        _ => return Ok(()),
    };

    // Convert day_keys to a set for quick lookup
    let day_set: HashSet<&str> = day_keys.iter().map(|s| s.as_str()).collect();

    // If workspace_path is specified, only scan that project's directory
    if let Some(workspace_path) = workspace_path {
        let encoded = encode_claude_project_path(&workspace_path.to_string_lossy());
        let project_dir = projects_dir.join(&encoded);
        if project_dir.exists() {
            scan_claude_project_dir(&project_dir, &day_set, daily, model_totals)?;
        }
        return Ok(());
    }

    // Otherwise, scan all project directories
    let entries = match std::fs::read_dir(&projects_dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_claude_project_dir(&path, &day_set, daily, model_totals)?;
        }
    }

    Ok(())
}

/// Encode a filesystem path to Claude's project directory name.
/// All non-alphanumeric characters (except hyphens) become hyphens.
fn encode_claude_project_path(path: &str) -> String {
    path.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Scan all JSONL files in a Claude project directory
fn scan_claude_project_dir(
    project_dir: &Path,
    day_set: &HashSet<&str>,
    daily: &mut HashMap<String, DailyTotals>,
    model_totals: &mut HashMap<String, i64>,
) -> Result<(), String> {
    let entries = match std::fs::read_dir(project_dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        // Only .jsonl files, skip agent-* subagent sessions
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                scan_claude_file(&path, day_set, daily, model_totals)?;
            }
        }
    }

    Ok(())
}

/// Scan a single Claude Code JSONL file for usage statistics.
/// Claude Code format has token info in message.usage and model in message.model
fn scan_claude_file(
    path: &Path,
    day_set: &HashSet<&str>,
    daily: &mut HashMap<String, DailyTotals>,
    model_totals: &mut HashMap<String, i64>,
) -> Result<(), String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return Ok(()),
    };
    let reader = BufReader::new(file);
    let mut last_activity_ms: Option<i64> = None;
    let mut seen_runs: HashSet<i64> = HashSet::new();

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

        let entry_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");

        // Only process assistant messages which contain usage info
        if entry_type != "assistant" {
            // Track user messages for activity and agent runs
            if entry_type == "user" {
                if let Some(timestamp_ms) = read_claude_timestamp(&value) {
                    if let Some(day_key) = day_key_for_timestamp_ms(timestamp_ms) {
                        if day_set.contains(day_key.as_str()) {
                            track_activity(daily, &mut last_activity_ms, timestamp_ms);
                        }
                    }
                }
            }
            continue;
        }

        // Extract message object which contains model and usage
        let message = match value.get("message").and_then(|v| v.as_object()) {
            Some(msg) => msg,
            None => continue,
        };

        // Extract model name
        let model = message
            .get("model")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Extract usage info
        let usage = match message.get("usage").and_then(|v| v.as_object()) {
            Some(u) => u,
            None => continue,
        };

        // Read token counts - Claude Code uses input_tokens, output_tokens, cache_read_input_tokens
        let input_tokens = usage
            .get("input_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let output_tokens = usage
            .get("output_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let cache_read = usage
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let cache_creation = usage
            .get("cache_creation_input_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        // Skip if no meaningful usage
        if input_tokens == 0 && output_tokens == 0 {
            continue;
        }

        // Get timestamp and day key
        let timestamp_ms = match read_claude_timestamp(&value) {
            Some(ts) => ts,
            None => continue,
        };

        let day_key = match day_key_for_timestamp_ms(timestamp_ms) {
            Some(key) => key,
            None => continue,
        };

        // Only process if this day is in our range
        if !day_set.contains(day_key.as_str()) {
            continue;
        }

        // Update daily totals
        if let Some(entry) = daily.get_mut(&day_key) {
            entry.input += input_tokens;
            entry.cached += cache_read + cache_creation;
            entry.output += output_tokens;

            // Count as agent run
            if seen_runs.insert(timestamp_ms) {
                entry.agent_runs += 1;
            }
        }

        // Update model totals
        if let Some(model_name) = model {
            let tokens = input_tokens + output_tokens;
            *model_totals.entry(model_name).or_insert(0) += tokens;
        }

        track_activity(daily, &mut last_activity_ms, timestamp_ms);
    }

    Ok(())
}

/// Read timestamp from Claude Code format (ISO 8601 string)
fn read_claude_timestamp(value: &Value) -> Option<i64> {
    value
        .get("timestamp")
        .and_then(|v| v.as_str())
        .and_then(|ts| {
            DateTime::parse_from_rfc3339(ts)
                .ok()
                .map(|dt| dt.timestamp_millis())
        })
}

