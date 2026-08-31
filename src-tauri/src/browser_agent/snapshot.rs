use super::*;

pub(crate) fn browser_snapshot_budget(settings: &BrowserAgentSettings) -> BrowserSnapshotBudget {
    BrowserSnapshotBudget {
        char_limit: settings.default_snapshot_budget_chars as usize,
        visible_text_limit: 8_000,
        element_limit: 120,
        form_field_limit: 80,
        diagnostic_limit: 50,
        token_estimate: None,
        truncated: false,
        omitted_element_count: 0,
    }
}

pub(crate) fn is_workspace_local_snapshot(session: &BrowserSession) -> bool {
    host_from_normalized_url(session.normalized_url.as_str())
        .map(|host| is_workspace_local_development_host(host.as_str()))
        .unwrap_or(false)
}

pub(crate) fn browser_code_candidates_for_session(session: &BrowserSession) -> Vec<BrowserCodeCandidate> {
    if !is_workspace_local_snapshot(session) {
        return Vec::new();
    }
    let route = session
        .normalized_url
        .split("://")
        .nth(1)
        .and_then(|rest| rest.split('/').skip(1).next())
        .unwrap_or_default();
    let route_path = session
        .normalized_url
        .split("://")
        .nth(1)
        .and_then(|rest| rest.split_once('/').map(|(_, path)| path))
        .map(|path| format!("/{path}"))
        .unwrap_or_else(|| "/".to_string());
    let leaf = route
        .split('/')
        .filter(|part| !part.trim().is_empty())
        .next_back()
        .unwrap_or("index");
    vec![BrowserCodeCandidate {
        candidate_id: format!("route_match:src/routes/{leaf}.tsx"),
        file_path: format!("src/routes/{leaf}.tsx"),
        symbol_name: None,
        reason: "route_match".to_string(),
        confidence: "low".to_string(),
        matched_text: Some(route_path),
    }]
}

pub(crate) fn compact_browser_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn mark_redaction(privacy: &mut BrowserPrivacyReport, kind: &str) {
    privacy.redaction_applied = true;
    if !privacy.redacted_kinds.iter().any(|entry| entry == kind) {
        privacy.redacted_kinds.push(kind.to_string());
    }
}

pub(crate) fn looks_sensitive(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("password")
        || lower.contains("passwd")
        || lower.contains("token")
        || lower.contains("secret")
        || lower.contains("authorization")
        || lower.contains("cookie")
        || lower.contains("api_key")
        || lower.contains("apikey")
}

pub(crate) fn redact_sensitive_assignments(value: &str, privacy: &mut BrowserPrivacyReport) -> String {
    let parts = value.split_whitespace().collect::<Vec<_>>();
    let mut redacted = Vec::with_capacity(parts.len());
    let mut redact_next = false;
    for part in parts {
        let lower = part.to_ascii_lowercase();
        if redact_next {
            redacted.push("[redacted-sensitive]".to_string());
            mark_redaction(privacy, "secret_like");
            redact_next = false;
            continue;
        }
        if let Some((key, _)) = part.split_once('=') {
            if looks_sensitive(key) {
                redacted.push(format!("{key}=[redacted]"));
                mark_redaction(privacy, "secret_like");
                continue;
            }
        }
        if let Some((key, _)) = part.split_once(':') {
            if looks_sensitive(key) {
                redacted.push(format!("{key}:[redacted]"));
                mark_redaction(privacy, "secret_like");
                continue;
            }
        }
        if lower == "authorization" || lower == "authorization:" || lower == "bearer" {
            redacted.push(part.to_string());
            redact_next = true;
            continue;
        }
        redacted.push(part.to_string());
    }
    redacted.join(" ")
}

pub(crate) fn sanitize_browser_string(
    value: Option<String>,
    limit: usize,
    privacy: &mut BrowserPrivacyReport,
) -> Option<String> {
    let raw = value?;
    if raw.trim().is_empty() {
        return None;
    }
    let mut sanitized =
        redact_sensitive_assignments(compact_browser_text(raw.as_str()).as_str(), privacy);
    if sanitized.contains('@') && sanitized.contains('.') {
        mark_redaction(privacy, "email");
        sanitized = sanitized
            .split_whitespace()
            .map(|part| {
                if part.contains('@') && part.contains('.') {
                    "[redacted-email]"
                } else {
                    part
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
    }
    Some(sanitized.chars().take(limit).collect::<String>())
}

pub(crate) fn sanitize_browser_target(
    mut target: BrowserActionTarget,
    privacy: &mut BrowserPrivacyReport,
) -> BrowserActionTarget {
    let sensitive_identity = [
        Some(target.label.as_str()),
        target.accessible_name.as_deref(),
        target.placeholder.as_deref(),
        target.href.as_deref(),
    ]
    .into_iter()
    .flatten()
    .any(looks_sensitive);
    target.sensitive = target.sensitive || sensitive_identity;
    target.label = sanitize_browser_string(Some(target.label), 320, privacy).unwrap_or_default();
    target.accessible_name = sanitize_browser_string(target.accessible_name, 320, privacy);
    target.text = sanitize_browser_string(target.text, 640, privacy);
    target.href = sanitize_browser_string(target.href, 640, privacy);
    target.placeholder = sanitize_browser_string(target.placeholder, 320, privacy);
    if target.sensitive {
        mark_redaction(privacy, "hidden_input");
        target.value_preview = None;
    } else {
        target.value_preview = sanitize_browser_string(target.value_preview, 320, privacy);
    }
    target
}

pub(crate) fn browser_element_landmarks_from_targets(
    links: &[BrowserActionTarget],
    buttons: &[BrowserActionTarget],
    forms: &[BrowserFormSummary],
) -> Vec<BrowserElementLandmark> {
    let link_landmarks = links.iter().take(40).map(|target| BrowserElementLandmark {
        landmark_id: target.target_id.clone(),
        role: "link".to_string(),
        label: target.label.clone(),
        text_preview: target.text.clone(),
        selector_hint: None,
        href: target.href.clone(),
        placeholder: target.placeholder.clone(),
        enabled: !target.disabled,
        visible: target.visible,
        sensitive: target.sensitive,
        bounds: target.bounds.clone(),
    });
    let button_landmarks = buttons
        .iter()
        .take(40)
        .map(|target| BrowserElementLandmark {
            landmark_id: target.target_id.clone(),
            role: "button".to_string(),
            label: target.label.clone(),
            text_preview: target.text.clone(),
            selector_hint: None,
            href: None,
            placeholder: target.placeholder.clone(),
            enabled: !target.disabled,
            visible: target.visible,
            sensitive: target.sensitive,
            bounds: target.bounds.clone(),
        });
    let field_landmarks = forms.iter().flat_map(|form| {
        form.fields
            .iter()
            .take(12)
            .map(|target| BrowserElementLandmark {
                landmark_id: target.target_id.clone(),
                role: target.kind.clone(),
                label: target.label.clone(),
                text_preview: target.text.clone(),
                selector_hint: None,
                href: None,
                placeholder: target.placeholder.clone(),
                enabled: !target.disabled,
                visible: target.visible,
                sensitive: target.sensitive,
                bounds: target.bounds.clone(),
            })
    });
    link_landmarks
        .chain(button_landmarks)
        .chain(field_landmarks)
        .take(120)
        .collect()
}

pub(crate) fn page_from_raw_capture(
    raw: BrowserRawCapture,
    budget: &mut BrowserSnapshotBudget,
    privacy: &mut BrowserPrivacyReport,
) -> BrowserContextSnapshotPage {
    let visible_text =
        sanitize_browser_string(raw.visible_text, budget.visible_text_limit, privacy)
            .unwrap_or_default();
    let text_truncated = visible_text.chars().count() >= budget.visible_text_limit;
    let headings = raw
        .headings
        .into_iter()
        .take(80)
        .map(|mut heading| {
            heading.text =
                sanitize_browser_string(Some(heading.text), 320, privacy).unwrap_or_default();
            heading
        })
        .collect::<Vec<_>>();
    let links = raw
        .links
        .into_iter()
        .take(80)
        .map(|target| sanitize_browser_target(target, privacy))
        .collect::<Vec<_>>();
    let buttons = raw
        .buttons
        .into_iter()
        .take(80)
        .map(|target| sanitize_browser_target(target, privacy))
        .collect::<Vec<_>>();
    let forms = raw
        .forms
        .into_iter()
        .take(20)
        .map(|mut form| {
            form.label =
                sanitize_browser_string(Some(form.label), 320, privacy).unwrap_or_default();
            form.action_origin = sanitize_browser_string(form.action_origin, 320, privacy);
            form.fields = form
                .fields
                .into_iter()
                .take(budget.form_field_limit)
                .map(|target| sanitize_browser_target(target, privacy))
                .collect();
            form.submit_targets = form
                .submit_targets
                .into_iter()
                .take(20)
                .map(|target| sanitize_browser_target(target, privacy))
                .collect();
            form
        })
        .collect::<Vec<_>>();
    let content_regions = raw
        .content_regions
        .into_iter()
        .take(8)
        .map(|mut region| {
            region.label =
                sanitize_browser_string(Some(region.label), 240, privacy).unwrap_or_default();
            region.text_preview =
                sanitize_browser_string(Some(region.text_preview), 1_200, privacy)
                    .unwrap_or_default();
            region
        })
        .collect::<Vec<_>>();
    let primary_content = raw.primary_content.map(|mut content| {
        content.text =
            sanitize_browser_string(Some(content.text), budget.visible_text_limit, privacy)
                .unwrap_or_default();
        content.truncated =
            content.truncated || content.text.chars().count() >= budget.visible_text_limit;
        content
    });
    let readable_blocks = raw
        .readable_blocks
        .into_iter()
        .take(12)
        .map(|mut block| {
            block.text =
                sanitize_browser_string(Some(block.text), 1_200, privacy).unwrap_or_default();
            block
        })
        .collect::<Vec<_>>();
    let noise_diagnostics = raw
        .noise_diagnostics
        .into_iter()
        .take(budget.diagnostic_limit)
        .map(|mut diagnostic| {
            diagnostic.message =
                sanitize_browser_string(Some(diagnostic.message), 320, privacy).unwrap_or_default();
            diagnostic
        })
        .collect::<Vec<_>>();
    let visual_evidence = raw
        .visual_evidence
        .into_iter()
        .take(20)
        .map(|mut item| {
            item.label =
                sanitize_browser_string(Some(item.label), 320, privacy).unwrap_or_default();
            item.alt_text = sanitize_browser_string(item.alt_text, 320, privacy);
            item.src_origin = sanitize_browser_string(item.src_origin, 320, privacy);
            item.nearby_text = if item.sensitive {
                None
            } else {
                sanitize_browser_string(item.nearby_text, 640, privacy)
            };
            item
        })
        .collect::<Vec<_>>();
    let element_landmarks = browser_element_landmarks_from_targets(&links, &buttons, &forms);
    let selected_text = sanitize_browser_string(raw.selected_text, 1_000, privacy);
    let used_elements =
        headings.len() + links.len() + buttons.len() + forms.len() + element_landmarks.len();
    budget.truncated = text_truncated || used_elements >= budget.element_limit;
    budget.omitted_element_count = used_elements.saturating_sub(budget.element_limit);
    BrowserContextSnapshotPage {
        visible_text,
        page_type: raw.page_type.unwrap_or(BrowserPageType::Unknown),
        primary_content,
        readable_blocks,
        noise_diagnostics,
        visual_evidence,
        text_truncated,
        headings,
        landmarks: Vec::new(),
        element_landmarks,
        content_regions,
        links,
        buttons,
        forms,
        selected_text,
        language_hint: raw
            .language_hint
            .and_then(|value| sanitize_browser_string(Some(value), 64, privacy)),
    }
}

pub(crate) async fn persist_snapshot_evidence(
    state: &State<'_, AppState>,
    snapshot: &BrowserContextSnapshot,
) -> BrowserContextSnapshotEvidence {
    let settings = current_settings(state).await;
    let retention_ms =
        u64::from(settings.evidence_retention_days).saturating_mul(24 * 60 * 60 * 1000);
    let evidence_id = browser_evidence_id(snapshot.snapshot_id.as_str());
    let record = BrowserEvidenceRecord {
        evidence_id: evidence_id.clone(),
        browser_session_id: snapshot.browser_session_id.clone(),
        snapshot_id: snapshot.snapshot_id.clone(),
        workspace_id: snapshot.workspace_id.clone(),
        url: snapshot.source.normalized_url.clone(),
        title: snapshot.source.title.clone(),
        captured_at: snapshot.captured_at,
        expires_at: snapshot.captured_at.saturating_add(retention_ms),
        state: "available".to_string(),
        summary: snapshot_summary(snapshot),
        privacy: snapshot.privacy.clone(),
        freshness: snapshot.freshness.clone(),
        diagnostics: snapshot.diagnostics.capture_warnings.clone(),
        code_candidates: snapshot.code_candidates.clone(),
    };
    state
        .browser_evidence
        .lock()
        .await
        .insert(evidence_id.clone(), record);
    BrowserContextSnapshotEvidence {
        screenshot_ref: Some(format!("browser-screenshot-ref-{}", snapshot.snapshot_id)),
        html_excerpt_ref: Some(evidence_id),
    }
}
