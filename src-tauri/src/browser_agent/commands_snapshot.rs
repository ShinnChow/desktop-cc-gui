use super::*;

#[tauri::command]
pub(crate) async fn capture_browser_agent_snapshot(
    browser_session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BrowserContextSnapshot, String> {
    let now = unix_time_ms();
    let settings = current_settings(&state).await;
    let session = {
        let sessions = state.browser_sessions.lock().await;
        sessions
            .get(browser_session_id.as_str())
            .cloned()
            .ok_or_else(|| format!("Browser session not found: {browser_session_id}"))?
    };
    if session.status == BrowserSessionStatus::Closed {
        return Err(format!("Browser session is closed: {browser_session_id}"));
    }
    let floating_renderer_matches = current_browser_renderer_session_id()
        .as_deref()
        .map(|bound_session_id| bound_session_id == browser_session_id)
        .unwrap_or(false)
        && app
            .get_webview_window(BROWSER_RENDERER_WINDOW_LABEL)
            .is_some();
    let embedded_renderer_matches = current_browser_embedded_webview_session_id()
        .as_deref()
        .map(|bound_session_id| bound_session_id == browser_session_id)
        .unwrap_or(false)
        && app.get_webview(BROWSER_RENDERER_WEBVIEW_LABEL).is_some();
    let renderer_matches = floating_renderer_matches || embedded_renderer_matches;

    let mut capture_warnings = Vec::new();
    if !renderer_matches {
        capture_warnings.push(browser_diagnostic(
            "browser-renderer-mismatch",
            "capture_warning",
            "warning",
            "Requested browser session is not bound to the active Browser Dock renderer; returning degraded metadata snapshot.",
        ));
    }
    let raw_capture = if renderer_matches && session.status == BrowserSessionStatus::Ready {
        match capture_browser_webview_dom(&app, browser_session_id.as_str()).await {
            Ok(raw) => Some(raw),
            Err(error) => {
                capture_warnings.push(browser_diagnostic(
                    "browser-capture-degraded",
                    "capture_warning",
                    "warning",
                    format!(
                        "Read-only WebView DOM transport failed; snapshot contains bounded session facts. {error}"
                    )
                    .as_str(),
                ));
                None
            }
        }
    } else {
        None
    };
    if raw_capture.is_none() && renderer_matches {
        capture_warnings.push(browser_diagnostic(
            "browser-capture-metadata-fallback",
            "capture_warning",
            "warning",
            "Browser Agent returned a metadata-only fallback snapshot.",
        ));
    }
    let has_live_capture = raw_capture.is_some();
    let code_candidates = browser_code_candidates_for_session(&session);
    let freshness = if has_live_capture {
        BrowserSnapshotFreshness::Fresh
    } else if renderer_matches && session.status == BrowserSessionStatus::Ready {
        BrowserSnapshotFreshness::Degraded
    } else {
        BrowserSnapshotFreshness::Stale
    };
    let mut budget = browser_snapshot_budget(&settings);
    let mut privacy = BrowserPrivacyReport {
        redaction_applied: false,
        redacted_kinds: Vec::new(),
        omitted_kinds: vec![
            "raw_dom".to_string(),
            "cookies".to_string(),
            "headers".to_string(),
            "scripts".to_string(),
            "styles".to_string(),
            "hidden_nodes".to_string(),
        ],
    };
    let mut omitted_capabilities = Vec::new();
    let (source_url, source_title, viewport, page) = if let Some(raw) = raw_capture {
        let raw_url = raw
            .url
            .clone()
            .unwrap_or_else(|| session.normalized_url.clone());
        let raw_title = raw.title.clone().or_else(|| session.title.clone());
        let viewport = raw
            .viewport
            .clone()
            .unwrap_or_else(default_browser_viewport);
        omitted_capabilities = raw.omitted_capabilities.clone();
        let page = page_from_raw_capture(raw, &mut budget, &mut privacy);
        (raw_url, raw_title, viewport, page)
    } else {
        let visible_text = session
            .title
            .as_ref()
            .map(|title| format!("{title}\n{}", session.normalized_url))
            .unwrap_or_else(|| session.normalized_url.clone());
        (
            session.normalized_url.clone(),
            session.title.clone(),
            default_browser_viewport(),
            BrowserContextSnapshotPage {
                visible_text,
                page_type: BrowserPageType::Unknown,
                primary_content: None,
                readable_blocks: Vec::new(),
                noise_diagnostics: Vec::new(),
                visual_evidence: Vec::new(),
                text_truncated: false,
                headings: Vec::new(),
                landmarks: Vec::new(),
                element_landmarks: Vec::new(),
                content_regions: Vec::new(),
                links: Vec::new(),
                buttons: Vec::new(),
                forms: Vec::new(),
                selected_text: None,
                language_hint: None,
            },
        )
    };
    let mut snapshot = BrowserContextSnapshot {
        snapshot_id: format!("browser-snapshot-{now}"),
        browser_session_id: session.browser_session_id.clone(),
        workspace_id: session.workspace_id.clone(),
        captured_at: now,
        freshness,
        source: BrowserSnapshotSource {
            url: source_url.clone(),
            normalized_url: source_url.clone(),
            origin: origin_from_normalized_url(source_url.as_str())
                .or_else(|| session.origin.clone()),
            title: source_title,
            tab_label: session.label.clone(),
            capture_reason: "manual_attach".to_string(),
            workspace_local_allowed: is_workspace_local_snapshot(&session),
        },
        viewport,
        page,
        code_candidates,
        diagnostics: BrowserContextSnapshotDiagnostics {
            console: Vec::new(),
            network: None,
            capture_warnings,
        },
        evidence: BrowserContextSnapshotEvidence {
            screenshot_ref: None,
            html_excerpt_ref: None,
        },
        omitted_capabilities,
        privacy,
        budget,
        availability: if has_live_capture {
            "available"
        } else {
            "partial"
        }
        .to_string(),
    };
    snapshot.evidence = persist_snapshot_evidence(&state, &snapshot).await;
    {
        let mut sessions = state.browser_sessions.lock().await;
        if let Some(session) = sessions.get_mut(browser_session_id.as_str()) {
            session.last_snapshot_id = Some(snapshot.snapshot_id.clone());
            session.updated_at = now;
        }
    }
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn capture_browser_agent_snapshot_v2(
    browser_session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BrowserContextSnapshot, String> {
    capture_browser_agent_snapshot(browser_session_id, app, state).await
}

#[tauri::command]
pub(crate) async fn refresh_browser_agent_snapshot(
    browser_session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BrowserContextSnapshot, String> {
    capture_browser_agent_snapshot(browser_session_id, app, state).await
}

#[tauri::command]
pub(crate) async fn generate_browser_agent_code_candidates(
    snapshot: BrowserContextSnapshot,
) -> Result<Vec<BrowserCodeCandidate>, String> {
    Ok(snapshot.code_candidates)
}
