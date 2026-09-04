use super::*;

#[tauri::command]
pub(crate) async fn create_browser_agent_session(
    request: CreateBrowserSessionRequest,
    state: State<'_, AppState>,
) -> Result<BrowserSession, String> {
    let settings = current_settings(&state).await;
    if !settings.enabled {
        return Err("Browser Agent is disabled in settings.".to_string());
    }

    let validation = validate_browser_url_for_workspace(
        request.url.as_str(),
        Some(request.workspace_id.as_str()),
    );
    let Some(normalized_url) = validation.normalized_url else {
        return Err(validation
            .diagnostic
            .map(|diagnostic| diagnostic.message)
            .unwrap_or_else(|| "Browser Agent URL is blocked.".to_string()));
    };

    let now = unix_time_ms();
    let browser_session_id = format!("browser-session-{}", uuid::Uuid::new_v4());
    let owner_surface = request.owner_surface.trim();
    let label = if owner_surface.is_empty() {
        "Browser Agent".to_string()
    } else {
        format!("Browser Agent · {owner_surface}")
    };
    let session = BrowserSession {
        browser_session_id: browser_session_id.clone(),
        workspace_id: request.workspace_id,
        label,
        url: normalized_url.clone(),
        normalized_url: normalized_url.clone(),
        origin: origin_from_normalized_url(normalized_url.as_str()),
        title: None,
        favicon_ref: None,
        status: BrowserSessionStatus::Loading,
        feature_phase: BrowserAgentFeaturePhase::ReadOnlySnapshot,
        platform_capability: platform::current_platform_capability(),
        linked_thread_id: None,
        linked_task_run_id: None,
        linked_orchestration_task_id: None,
        last_snapshot_id: None,
        last_action_id: None,
        error_code: None,
        diagnostic_message: None,
        created_at: now,
        updated_at: now,
        last_activated_at: now,
        closed_at: None,
    };

    state
        .browser_sessions
        .lock()
        .await
        .insert(browser_session_id, session.clone());
    Ok(session)
}

#[tauri::command]
pub(crate) async fn list_browser_agent_sessions(
    workspace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<BrowserSession>, String> {
    let sessions = state.browser_sessions.lock().await;
    let mut list = sessions
        .values()
        .filter(|session| {
            workspace_id
                .as_deref()
                .map(|id| session.workspace_id == id)
                .unwrap_or(true)
        })
        .cloned()
        .collect::<Vec<_>>();
    list.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(list)
}

#[tauri::command]
pub(crate) async fn update_browser_agent_session(
    request: UpdateBrowserSessionRequest,
    state: State<'_, AppState>,
) -> Result<BrowserSession, String> {
    let now = unix_time_ms();
    let mut sessions = state.browser_sessions.lock().await;
    let session = sessions
        .get_mut(request.browser_session_id.as_str())
        .ok_or_else(|| format!("Browser session not found: {}", request.browser_session_id))?;

    if let Some(next_url) = request.url {
        let validation =
            validate_browser_url_for_workspace(next_url.as_str(), request.workspace_id.as_deref());
        let Some(normalized_url) = validation.normalized_url else {
            return Err(validation
                .diagnostic
                .map(|diagnostic| diagnostic.message)
                .unwrap_or_else(|| "Browser Agent URL is blocked.".to_string()));
        };
        session.url = normalized_url.clone();
        session.normalized_url = normalized_url.clone();
        session.origin = origin_from_normalized_url(normalized_url.as_str());
    }
    if let Some(status) = request.status {
        session.status = status;
    }
    if request.title.is_some() {
        session.title = request.title;
    }
    if request.last_snapshot_id.is_some() {
        session.last_snapshot_id = request.last_snapshot_id;
    }
    if request.last_action_id.is_some() {
        session.last_action_id = request.last_action_id;
    }
    if request.error_code.is_some() {
        session.error_code = request.error_code;
    }
    if request.diagnostic_message.is_some() {
        session.diagnostic_message = request.diagnostic_message;
    }
    session.updated_at = now;
    session.last_activated_at = now;
    Ok(session.clone())
}

#[tauri::command]
pub(crate) async fn close_browser_agent_session(
    browser_session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BrowserSession, String> {
    let now = unix_time_ms();
    let mut sessions = state.browser_sessions.lock().await;
    let session = sessions
        .get_mut(browser_session_id.as_str())
        .ok_or_else(|| format!("Browser session not found: {browser_session_id}"))?;
    session.status = BrowserSessionStatus::Closed;
    session.updated_at = now;
    session.closed_at = Some(now);
    let should_close_floating_window = browser_renderer_session_binding()
        .lock()
        .map(|binding| binding.as_deref() == Some(browser_session_id.as_str()))
        .unwrap_or(false);
    let should_close_embedded_renderer = current_browser_embedded_webview_session_id().as_deref()
        == Some(browser_session_id.as_str());
    clear_browser_renderer_session(browser_session_id.as_str());
    clear_browser_embedded_webview_session(browser_session_id.as_str());
    if should_close_floating_window {
        if let Some(window) = app.get_webview_window(BROWSER_RENDERER_WINDOW_LABEL) {
            let _ = window.close();
        }
    }
    if should_close_embedded_renderer {
        if let Some(webview) = app.get_webview(BROWSER_RENDERER_WEBVIEW_LABEL) {
            let _ = webview.close();
        }
    }
    Ok(session.clone())
}

#[tauri::command]
pub(crate) async fn cleanup_browser_agent_sessions(
    max_closed_age_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<BrowserSessionCleanupResult, String> {
    let now = unix_time_ms();
    let max_closed_age_ms = max_closed_age_ms.unwrap_or(30 * 60 * 1000);
    let mut sessions = state.browser_sessions.lock().await;
    let removed_session_ids = sessions
        .values()
        .filter(|session| is_cleanup_candidate(session, now, max_closed_age_ms))
        .map(|session| session.browser_session_id.clone())
        .collect::<Vec<_>>();

    for session_id in &removed_session_ids {
        sessions.remove(session_id);
    }

    Ok(BrowserSessionCleanupResult {
        removed_session_ids,
        retained_session_count: sessions.len(),
    })
}

#[tauri::command]
pub(crate) async fn list_browser_agent_evidence(
    workspace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<BrowserEvidenceRecord>, String> {
    let now = unix_time_ms();
    let evidence = state.browser_evidence.lock().await;
    let mut records = evidence
        .values()
        .filter(|record| {
            workspace_id
                .as_deref()
                .map(|id| record.workspace_id == id)
                .unwrap_or(true)
        })
        .cloned()
        .map(|mut record| {
            if record.expires_at <= now && record.state == "available" {
                record.state = "expired".to_string();
            }
            record
        })
        .collect::<Vec<_>>();
    records.sort_by(|left, right| right.captured_at.cmp(&left.captured_at));
    Ok(records)
}

#[tauri::command]
pub(crate) async fn cleanup_browser_agent_evidence(
    now: Option<u64>,
    state: State<'_, AppState>,
) -> Result<BrowserEvidenceCleanupResult, String> {
    let now = now.unwrap_or_else(unix_time_ms);
    let mut evidence = state.browser_evidence.lock().await;
    let removed_evidence_ids = evidence
        .values()
        .filter(|record| record.expires_at <= now)
        .map(|record| record.evidence_id.clone())
        .collect::<Vec<_>>();
    for evidence_id in &removed_evidence_ids {
        evidence.remove(evidence_id);
    }
    Ok(BrowserEvidenceCleanupResult {
        removed_evidence_ids,
        retained_evidence_count: evidence.len(),
    })
}
