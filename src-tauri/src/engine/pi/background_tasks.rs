use super::*;

/// pi-background-tasks extension tools that LAUNCH a durable background task
/// (the tool returns a receipt immediately; terminal state arrives later via a
/// `<background-task-notification>` followUp). Control tools (`bg_status` /
/// `bg_logs` / `bg_kill` / `bg_result`) are deliberately excluded: they keep
/// rendering as generic tool cards.
pub(crate) const PI_BACKGROUND_TASK_TOOLS: &[&str] = &[
    "bg_run",
    "bg_delegate",
    "bg_run_pi_attested",
    "fusion_reason",
    "fusion_investigate",
    "fusion_research",
    "fusion_validate",
];

/// `customType` the pi-background-tasks extension stamps on its terminal
/// followUp message (spike 2026-08-26: RPC `message_start`/`message_end` with
/// `message.role == "custom"`, structured snapshot under `message.details`).
pub(crate) const PI_BACKGROUND_TASK_NOTIFICATION_CUSTOM_TYPE: &str = "background-task-notification";

pub(crate) fn is_pi_background_task_tool(tool_name: &str) -> bool {
    PI_BACKGROUND_TASK_TOOLS.contains(&tool_name.trim())
}

/// Canonical task snapshot from a bg tool receipt. The extension attaches the
/// full snapshot at `result.details.task` (spike-verified); the text receipt is
/// parsed as a fallback for older extension versions. Returns None when neither
/// yields a task id — callers then degrade to a generic tool card.
pub(crate) fn parse_pi_background_task_receipt(result: Option<&Value>) -> Option<Value> {
    let result = result?;
    if let Some(task) = result
        .get("details")
        .and_then(|details| details.get("task"))
    {
        if task.get("id").and_then(Value::as_str).is_some() {
            return Some(task.clone());
        }
    }
    parse_pi_background_task_receipt_text(&extract_tool_result_text(Some(result)))
}

/// Text receipt fallback shape:
/// `Started background task <name> (<id>)\nStatus: running\nPID: 26137\nOutput: <path>`
pub(crate) fn parse_pi_background_task_receipt_text(text: &str) -> Option<Value> {
    let first_line = text.lines().next()?.trim();
    let rest = first_line.strip_prefix("Started background task ")?;
    let open = rest.rfind('(')?;
    let close = rest.rfind(')')?;
    if close <= open {
        return None;
    }
    let id = rest[open + 1..close].trim();
    if id.is_empty() {
        return None;
    }
    let name = rest[..open].trim();
    let mut task = json!({ "id": id, "status": "running" });
    if !name.is_empty() {
        task["name"] = json!(name);
    }
    for line in text.lines().skip(1) {
        let line = line.trim();
        if let Some(output) = line.strip_prefix("Output: ") {
            task["outputPath"] = json!(output.trim());
        } else if let Some(pid) = line.strip_prefix("PID: ") {
            if let Ok(pid) = pid.trim().parse::<u64>() {
                task["pid"] = json!(pid);
            }
        }
    }
    Some(task)
}

/// Canonical task snapshot from a `<background-task-notification>` wakeup:
/// prefer the structured `message.details` snapshot; fall back to the XML-ish
/// `content` envelope for older extension versions. None when no task id.
pub(crate) fn parse_pi_background_task_notification(
    details: Option<Value>,
    content: &str,
) -> Option<Value> {
    fn strip_xml_tags(value: &str) -> String {
        let mut output = String::with_capacity(value.len());
        let mut in_tag = false;
        for ch in value.chars() {
            match ch {
                '<' => in_tag = true,
                '>' if in_tag => in_tag = false,
                _ if !in_tag => output.push(ch),
                _ => {}
            }
        }
        output.split_whitespace().collect::<Vec<_>>().join(" ")
    }
    fn is_machine_completion_summary(value: &str) -> bool {
        let normalized = value.trim().to_ascii_lowercase();
        let machine_prefixes = [
            "background task ",
            "background shell task ",
            "background command ",
        ];
        let terminal_suffixes = [
            " completed",
            " failed",
            " killed",
            " cancelled",
            " canceled",
        ];
        machine_prefixes
            .iter()
            .any(|prefix| normalized.starts_with(prefix))
            && terminal_suffixes
                .iter()
                .any(|suffix| normalized.ends_with(suffix))
    }
    fn completion_text_from_details(details: &Value) -> Option<String> {
        ["summary", "result"]
            .iter()
            .filter_map(|key| details.get(*key))
            .find_map(|value| {
                value
                    .as_str()
                    .map(strip_xml_tags)
                    .filter(|text| !text.is_empty() && !is_machine_completion_summary(text))
            })
    }
    fn tag<'a>(text: &'a str, name: &str) -> Option<&'a str> {
        let open = format!("<{name}>");
        let close = format!("</{name}>");
        let start = text.find(&open)? + open.len();
        let end = text[start..].find(&close)? + start;
        let value = text[start..end].trim();
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    }
    let content_completion_text = ["summary", "result"]
        .iter()
        .filter_map(|name| tag(content, name))
        .find_map(|value| {
            let text = strip_xml_tags(value);
            (!text.is_empty() && !is_machine_completion_summary(&text)).then_some(text)
        });
    if let Some(details) = details {
        if details.get("id").and_then(Value::as_str).is_some() {
            let mut task = details;
            let existing_machine_summary = task
                .get("completionText")
                .and_then(Value::as_str)
                .map(is_machine_completion_summary)
                .unwrap_or(false);
            if task.get("completionText").is_none() || existing_machine_summary {
                if let Some(text) = content_completion_text
                    .clone()
                    .or_else(|| completion_text_from_details(&task))
                {
                    task["completionText"] = json!(text);
                } else if existing_machine_summary {
                    if let Some(object) = task.as_object_mut() {
                        object.remove("completionText");
                    }
                }
            }
            return Some(task);
        }
    }
    let id = tag(content, "task-id")?;
    let mut task = json!({ "id": id });
    if let Some(name) = tag(content, "task-name") {
        task["name"] = json!(name);
    }
    if let Some(status) = tag(content, "status") {
        task["status"] = json!(status);
    }
    if let Some(code) = tag(content, "exit-code").and_then(|v| v.parse::<i64>().ok()) {
        task["exitCode"] = json!(code);
    }
    if let Some(output) = tag(content, "output-file") {
        task["outputPath"] = json!(output);
    }
    if let Some(description) = content_completion_text {
        task["completionText"] = json!(description);
    }
    Some(task)
}
