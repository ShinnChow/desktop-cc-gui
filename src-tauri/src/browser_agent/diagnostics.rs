use super::*;

pub(crate) fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn browser_diagnostic(
    diagnostic_id: &str,
    kind: &str,
    severity: &str,
    message: &str,
) -> BrowserDiagnostic {
    BrowserDiagnostic {
        diagnostic_id: diagnostic_id.to_string(),
        kind: kind.to_string(),
        severity: severity.to_string(),
        message: message.to_string(),
        source: Some("browser_agent".to_string()),
        redacted: true,
    }
}

pub(crate) fn blocked_url(raw_url: &str, blocked_reason: &str, message: &str) -> BrowserUrlValidationResult {
    BrowserUrlValidationResult {
        raw_url: raw_url.to_string(),
        normalized_url: None,
        allowed: false,
        blocked_reason: Some(blocked_reason.to_string()),
        diagnostic: Some(browser_diagnostic(
            "browser-url-blocked",
            "security_warning",
            "warning",
            message,
        )),
        workspace_local_allowed: false,
    }
}

pub(crate) fn origin_from_normalized_url(normalized_url: &str) -> Option<String> {
    let (scheme, rest) = normalized_url.split_once("://")?;
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .trim();
    if authority.is_empty() {
        return None;
    }
    Some(format!("{scheme}://{authority}"))
}

pub(crate) fn host_from_normalized_url(normalized_url: &str) -> Option<String> {
    let (_, rest) = normalized_url.split_once("://")?;
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .trim();
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    let host = if host_port.starts_with('[') {
        host_port
            .trim_start_matches('[')
            .split(']')
            .next()
            .unwrap_or_default()
    } else {
        host_port.split(':').next().unwrap_or_default()
    };
    let normalized = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

pub(crate) fn is_blocked_local_host(host: &str) -> bool {
    host == "localhost"
        || host == "::1"
        || host.starts_with("127.")
        || host == "0.0.0.0"
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("172.16.")
        || host.starts_with("172.17.")
        || host.starts_with("172.18.")
        || host.starts_with("172.19.")
        || host.starts_with("172.20.")
        || host.starts_with("172.21.")
        || host.starts_with("172.22.")
        || host.starts_with("172.23.")
        || host.starts_with("172.24.")
        || host.starts_with("172.25.")
        || host.starts_with("172.26.")
        || host.starts_with("172.27.")
        || host.starts_with("172.28.")
        || host.starts_with("172.29.")
        || host.starts_with("172.30.")
        || host.starts_with("172.31.")
}

pub(crate) fn is_workspace_local_development_host(host: &str) -> bool {
    host == "localhost" || host == "::1" || host.starts_with("127.")
}

pub(crate) fn is_cleanup_candidate(session: &BrowserSession, now: u64, max_closed_age_ms: u64) -> bool {
    let terminal = matches!(
        session.status,
        BrowserSessionStatus::Closed
            | BrowserSessionStatus::Failed
            | BrowserSessionStatus::Unsupported
    );
    terminal && now.saturating_sub(session.updated_at) > max_closed_age_ms
}

pub(crate) fn browser_evidence_id(snapshot_id: &str) -> String {
    format!("browser-evidence-{snapshot_id}")
}

pub(crate) fn snapshot_summary(snapshot: &BrowserContextSnapshot) -> String {
    let title = snapshot
        .source
        .title
        .as_deref()
        .unwrap_or(snapshot.source.normalized_url.as_str());
    let text = snapshot
        .page
        .primary_content
        .as_ref()
        .map(|content| content.text.as_str())
        .unwrap_or(snapshot.page.visible_text.as_str())
        .replace('\n', " ");
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return title.to_string();
    }
    let excerpt = compact.chars().take(360).collect::<String>();
    format!("{title}\n{excerpt}")
}

pub(crate) fn default_browser_viewport() -> BrowserViewportState {
    BrowserViewportState {
        width: None,
        height: None,
        scroll_x: None,
        scroll_y: None,
        scroll_height: None,
        scroll_width: None,
        device_pixel_ratio: None,
    }
}

pub(crate) fn current_browser_renderer_session_id() -> Option<String> {
    browser_renderer_session_binding()
        .lock()
        .ok()
        .and_then(|binding| binding.clone())
}
