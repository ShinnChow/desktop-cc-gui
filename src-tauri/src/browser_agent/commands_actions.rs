use super::*;

#[tauri::command]
pub(crate) async fn run_browser_agent_action(
    request: BrowserActionRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BrowserActionResult, String> {
    let now = unix_time_ms();
    let settings = current_settings(&state).await;
    let action = request.action.clone();
    let is_safe_navigation = matches!(action.as_str(), "navigate" | "reload" | "scroll");
    let is_element_action = matches!(action.as_str(), "click" | "type" | "select" | "submit");
    let feature_allowed = if is_safe_navigation {
        settings.allow_navigation_actions
    } else if action == "submit" {
        settings.allow_form_submit_actions
    } else if is_element_action {
        settings.allow_element_actions
    } else {
        false
    };
    let action_id = format!("browser-action-{now}");
    let before_snapshot_id = {
        let sessions = state.browser_sessions.lock().await;
        sessions
            .get(request.browser_session_id.as_str())
            .and_then(|session| session.last_snapshot_id.clone())
    };
    let mut blocked_reasons = Vec::new();
    if !request.confirmed {
        blocked_reasons.push("not_confirmed".to_string());
    }
    if !feature_allowed {
        blocked_reasons.push("settings_disabled".to_string());
    }
    if is_element_action {
        blocked_reasons.push("mutating_action_blocked_by_default".to_string());
    }
    let gate = BrowserActionGateResolution {
        allowed: settings.enabled && request.confirmed && is_safe_navigation && feature_allowed,
        blocked_reasons: if blocked_reasons.is_empty() {
            vec!["requires_user_confirmation".to_string()]
        } else {
            blocked_reasons.clone()
        },
    };
    let preview = BrowserActionPreview {
        action_id: action_id.clone(),
        browser_session_id: request.browser_session_id.clone(),
        action: action.clone(),
        target_id: request.target_id.clone(),
        target_description: request.target_id.clone(),
        value_preview: request.value.as_ref().map(|value| {
            if action == "type" || action == "submit" {
                "[redacted-preview]".to_string()
            } else {
                value.chars().take(80).collect::<String>()
            }
        }),
        reason: request.reason.clone(),
        risk_level: if is_safe_navigation { "low" } else if is_element_action { "medium" } else { "high" }.to_string(),
        requires_user_confirmation: true,
        blocked_by_default: !is_safe_navigation,
        before_snapshot_id: before_snapshot_id.clone(),
        after_snapshot_id: None,
        expected_effect: match action.as_str() {
            "navigate" => "Load the requested page in the active Browser Dock session.",
            "reload" => "Reload the active Browser Dock page.",
            "scroll" => "Scroll the active Browser Dock page.",
            _ => "Preview only; mutating actions remain blocked by default.",
        }.to_string(),
        privacy_notice: "Browser actions require explicit confirmation; secret-like values are redacted in previews.".to_string(),
        gate: gate.clone(),
    };
    let mut outcome = "blocked".to_string();
    let mut diagnostic_message = if !settings.enabled {
        Some("Browser Agent is disabled in settings.".to_string())
    } else if !request.confirmed {
        Some("Browser action was not confirmed; no operation was executed.".to_string())
    } else if !is_safe_navigation {
        Some("Browser Agent mutating actions remain blocked by default.".to_string())
    } else if !feature_allowed {
        Some("Browser Agent safe navigation actions are disabled in settings.".to_string())
    } else {
        None
    };
    let mut after_snapshot_id = None;

    if gate.allowed {
        let execution_result = match action.as_str() {
            "navigate" => {
                let target_url = request
                    .value
                    .as_deref()
                    .or(request.target_id.as_deref())
                    .ok_or_else(|| "navigate action requires a target URL.".to_string())
                    .and_then(|target| {
                        let validation = validate_browser_url_for_workspace(target, None);
                        validation.normalized_url.ok_or_else(|| {
                            validation
                                .diagnostic
                                .map(|diagnostic| diagnostic.message)
                                .unwrap_or_else(|| "Browser Agent URL is blocked.".to_string())
                        })
                    });
                match target_url {
                    Ok(url) => {
                        let parsed_url = url
                            .parse()
                            .map_err(|error| format!("Invalid Browser Agent URL: {error}"));
                        match parsed_url {
                            Ok(parsed_url) => navigate_browser_renderer(
                                &app,
                                request.browser_session_id.as_str(),
                                parsed_url,
                            ),
                            Err(error) => Err(error),
                        }
                    }
                    Err(error) => Err(error),
                }
            }
            "reload" => eval_browser_renderer_script(
                &app,
                request.browser_session_id.as_str(),
                "window.location.reload()",
            ),
            "scroll" => {
                let scroll_value = request.value.as_deref().unwrap_or("window.innerHeight");
                let script = format!(
                    "window.scrollBy(0, Number({}) || window.innerHeight)",
                    escape_js_string(scroll_value)
                );
                eval_browser_renderer_script(&app, request.browser_session_id.as_str(), script)
            }
            _ => Err("Unsupported Browser Agent action.".to_string()),
        };
        match execution_result {
            Ok(()) => {
                outcome = "completed".to_string();
                after_snapshot_id = Some(format!("browser-snapshot-after-{now}"));
                diagnostic_message = None;
            }
            Err(error) => {
                outcome = "failed".to_string();
                diagnostic_message = Some(error);
            }
        }
    }

    let audit_entry = BrowserActionAuditEntry {
        action_id,
        browser_session_id: request.browser_session_id,
        requested_at: now,
        completed_at: Some(now),
        action,
        target_description: request.target_id,
        outcome: outcome.clone(),
        diagnostic_message,
        before_snapshot_id: before_snapshot_id.clone(),
        after_snapshot_id: after_snapshot_id.clone(),
        comparison: Some(BrowserActionSnapshotComparison {
            before_snapshot_id,
            after_snapshot_id,
            state: (if outcome == "completed" {
                "available"
            } else {
                "failed"
            })
            .to_string(),
            diagnostics: if outcome == "completed" {
                Vec::new()
            } else {
                gate.blocked_reasons.clone()
            },
        }),
    };

    Ok(BrowserActionResult {
        outcome,
        audit_entry,
        preview: Some(preview),
    })
}
