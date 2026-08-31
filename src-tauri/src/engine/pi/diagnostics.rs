use super::*;

pub(crate) fn pi_failure_category(error: &str) -> &'static str {
    let normalized = error.to_ascii_lowercase();
    if normalized.contains("fetch failed") || normalized.contains("network") {
        "upstream_transport"
    } else if normalized.contains("oauth")
        || normalized.contains("token")
        || normalized.contains("unauthorized")
        || normalized.contains("forbidden")
    {
        "authentication"
    } else if normalized.contains("model") {
        "model_selection"
    } else if normalized.contains("stopped") || normalized.contains("cancel") {
        "cancelled"
    } else if normalized.contains("exited") {
        "local_process_exit"
    } else {
        "runtime_error"
    }
}

pub(crate) fn bounded_pi_diagnostic(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(120).collect())
        .unwrap_or_else(|| "<unknown>".to_string())
}

pub(crate) fn log_pi_failure_envelope(
    model: Option<&str>,
    runtime_mode: &str,
    surface: &str,
    error: &str,
    task_id: Option<&str>,
    saw_assistant_output: bool,
    saw_tool_activity: bool,
) {
    log::warn!(
        "[pi/provider-failure] model={} runtime_mode={} surface={} category={} task_id={} saw_assistant_output={} saw_tool_activity={}",
        bounded_pi_diagnostic(model),
        runtime_mode,
        surface,
        pi_failure_category(error),
        bounded_pi_diagnostic(task_id),
        saw_assistant_output,
        saw_tool_activity,
    );
}

pub(crate) fn pi_background_task_failure(task: &Value) -> bool {
    matches!(
        task.get("status").and_then(Value::as_str),
        Some("failed" | "killed" | "cancelled")
    ) || task
        .get("exitCode")
        .and_then(Value::as_i64)
        .is_some_and(|code| code != 0)
}

pub(crate) fn log_pi_background_task_failure(
    model: Option<&str>,
    runtime_mode: &str,
    task: &Value,
    saw_assistant_output: bool,
    saw_tool_activity: bool,
) {
    if !pi_background_task_failure(task) {
        return;
    }
    log_pi_failure_envelope(
        model,
        runtime_mode,
        "background-task",
        "background task failed",
        task.get("id").and_then(Value::as_str),
        saw_assistant_output,
        saw_tool_activity,
    );
}
