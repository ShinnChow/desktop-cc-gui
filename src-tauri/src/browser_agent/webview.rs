use super::*;

pub(crate) fn close_legacy_browser_child_webviews(app: &AppHandle) {
    // 旧版曾为每个 tab 建 child WebView；升级后的 renderer 固定为单实例。热更新场景
    // 下先清理遗留实例，避免它们继续盖住当前 Browser Dock surface。
    let legacy_labels: Vec<String> = app
        .webviews()
        .into_keys()
        .filter(|label| {
            label.starts_with("browser-agent-webview-")
                && label.as_str() != BROWSER_RENDERER_WEBVIEW_LABEL
        })
        .collect();
    for label in legacy_labels {
        if let Some(webview) = app.get_webview(label.as_str()) {
            let _ = webview.close();
        }
    }
}

pub(crate) fn valid_webview_bounds(bounds: &BrowserWebviewBounds) -> bool {
    bounds.x.is_finite()
        && bounds.y.is_finite()
        && bounds.width.is_finite()
        && bounds.height.is_finite()
        && bounds.width >= 40.0
        && bounds.height >= 40.0
}

pub(crate) fn browser_webview_rect(bounds: &BrowserWebviewBounds) -> tauri::Rect {
    tauri::Rect {
        position: tauri::Position::Logical(tauri::LogicalPosition::new(bounds.x, bounds.y)),
        size: tauri::Size::Logical(tauri::LogicalSize::new(bounds.width, bounds.height)),
    }
}

pub(crate) fn emit_browser_webview_event(app: &AppHandle, event: BrowserWebviewEvent) {
    let _ = app.emit(BROWSER_WEBVIEW_EVENT, event);
}

pub(crate) fn eval_browser_renderer_script(
    app: &AppHandle,
    browser_session_id: &str,
    script: impl Into<String>,
) -> Result<(), String> {
    let script = script.into();
    let renderer_matches = current_browser_renderer_session_id()
        .as_deref()
        .map(|session_id| session_id == browser_session_id)
        .unwrap_or(false);
    if renderer_matches {
        if let Some(window) = app.get_webview_window(BROWSER_RENDERER_WINDOW_LABEL) {
            return window.eval(script).map_err(|error| error.to_string());
        }
    }

    if current_browser_embedded_webview_session_id().as_deref() != Some(browser_session_id) {
        return Err(format!(
            "Browser Agent embedded renderer is not active for session: {browser_session_id}"
        ));
    }
    let webview = app
        .get_webview(BROWSER_RENDERER_WEBVIEW_LABEL)
        .ok_or_else(|| format!("Browser Agent renderer not found: {browser_session_id}"))?;
    webview.eval(script).map_err(|error| error.to_string())
}

pub(crate) fn navigate_browser_renderer(
    app: &AppHandle,
    browser_session_id: &str,
    url: tauri::Url,
) -> Result<(), String> {
    let renderer_matches = current_browser_renderer_session_id()
        .as_deref()
        .map(|session_id| session_id == browser_session_id)
        .unwrap_or(false);
    if renderer_matches {
        if let Some(window) = app.get_webview_window(BROWSER_RENDERER_WINDOW_LABEL) {
            return window.navigate(url).map_err(|error| error.to_string());
        }
    }

    if current_browser_embedded_webview_session_id().as_deref() != Some(browser_session_id) {
        return Err(format!(
            "Browser Agent embedded renderer is not active for session: {browser_session_id}"
        ));
    }
    let webview = app
        .get_webview(BROWSER_RENDERER_WEBVIEW_LABEL)
        .ok_or_else(|| format!("Browser Agent renderer not found: {browser_session_id}"))?;
    webview.navigate(url).map_err(|error| error.to_string())
}

pub(crate) fn resolve_browser_parent_window(
    app: &AppHandle,
) -> Result<tauri::WebviewWindow<tauri::Wry>, String> {
    let windows = app.webview_windows();
    let labels = windows
        .keys()
        .map(|label| label.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    if let Some(window) = windows
        .values()
        .find(|window| {
            window.label() != "about"
                && window.label() != BROWSER_RENDERER_WEBVIEW_LABEL
                && window.is_focused().unwrap_or(false)
        })
        .cloned()
    {
        return Ok(window);
    }
    if let Some(window) = app.get_webview_window("main") {
        return Ok(window);
    }
    if let Some(window) = windows.into_values().find(|window| {
        window.label() != "about" && window.label() != BROWSER_RENDERER_WEBVIEW_LABEL
    }) {
        return Ok(window);
    }
    if labels.is_empty() {
        return Err(
            "Main window not found for Browser Agent WebView. No webview windows are registered."
                .to_string(),
        );
    }
    Err(format!(
        "Main window not found for Browser Agent WebView. Registered windows: {labels}"
    ))
}

pub(crate) fn spawn_browser_webview_session_patch(
    app: AppHandle,
    browser_session_id: String,
    status: Option<BrowserSessionStatus>,
    url: Option<String>,
    title: Option<String>,
    error_code: Option<String>,
    diagnostic_message: Option<String>,
) {
    tauri::async_runtime::spawn(async move {
        let now = unix_time_ms();
        let label = BROWSER_RENDERER_WEBVIEW_LABEL.to_string();
        let event = {
            let state = app.state::<AppState>();
            let mut sessions = state.browser_sessions.lock().await;
            let Some(session) = sessions.get_mut(browser_session_id.as_str()) else {
                return;
            };

            if let Some(next_url) = url.as_ref() {
                session.url = next_url.clone();
                session.normalized_url = next_url.clone();
                session.origin = origin_from_normalized_url(next_url.as_str());
            }
            if let Some(next_title) = title.as_ref() {
                session.title = if next_title.trim().is_empty() {
                    None
                } else {
                    Some(next_title.clone())
                };
            }
            if let Some(next_status) = status.as_ref() {
                session.status = next_status.clone();
            }
            if error_code.is_some() {
                session.error_code = error_code.clone();
            }
            if diagnostic_message.is_some() {
                session.diagnostic_message = diagnostic_message.clone();
            }
            session.updated_at = now;
            session.last_activated_at = now;

            BrowserWebviewEvent {
                browser_session_id: browser_session_id.clone(),
                label,
                url,
                title,
                status: session.status.clone(),
                occurred_at: now,
                error_code,
                diagnostic_message,
            }
        };
        emit_browser_webview_event(&app, event);
    });
}

pub(crate) fn create_browser_child_webview(
    app: &AppHandle,
    session: &BrowserSession,
    bounds: &BrowserWebviewBounds,
) -> Result<(), String> {
    if !valid_webview_bounds(bounds) {
        return Err("Browser Agent WebView bounds are too small.".to_string());
    }

    let label = BROWSER_RENDERER_WEBVIEW_LABEL;
    let url: tauri::Url = session
        .normalized_url
        .parse()
        .map_err(|error| format!("Invalid Browser Agent URL: {error}"))?;
    close_legacy_browser_child_webviews(app);
    if let Some(webview) = app.get_webview(label) {
        webview
            .navigate(url)
            .map_err(|error| format!("Failed to navigate Browser Agent WebView: {error}"))?;
        let _ = webview.set_auto_resize(false);
        webview
            .set_bounds(browser_webview_rect(bounds))
            .map_err(|error| error.to_string())?;
        webview.show().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let window = resolve_browser_parent_window(app)?;
    let workspace_id_for_navigation = session.workspace_id.clone();
    let app_for_navigation = app.clone();
    let app_for_load = app.clone();
    let app_for_title = app.clone();

    let webview_builder = WebviewBuilder::new(label, WebviewUrl::External(url))
        .on_navigation(move |target_url| {
            // renderer 已隐藏或被关闭后仍可能收到迟到的 navigation 回调；无 active
            // binding 时不能回退到首次创建该 WebView 的 tab。
            let Some(active_session_id) = current_browser_embedded_webview_session_id() else {
                return false;
            };
            if handle_browser_tab_context_menu_navigation(&app_for_navigation, target_url.as_str())
            {
                return false;
            }
            // 元素选择器完成时通过 bridge URL 回传选中元素证据（与浮动窗同一通道）
            if handle_browser_toolbar_navigation(
                &app_for_navigation,
                target_url.as_str(),
                active_session_id.as_str(),
                workspace_id_for_navigation.as_str(),
            ) {
                return false;
            }
            if handle_browser_capture_navigation(target_url.as_str()) {
                return false;
            }
            let validation = validate_browser_url_for_workspace(
                target_url.as_str(),
                Some(workspace_id_for_navigation.as_str()),
            );
            if validation.allowed {
                update_browser_embedded_webview_navigation_target(
                    active_session_id.as_str(),
                    target_url.as_str(),
                );
                return true;
            }
            spawn_browser_webview_session_patch(
                app_for_navigation.clone(),
                active_session_id,
                Some(BrowserSessionStatus::Blocked),
                Some(target_url.to_string()),
                None,
                validation.blocked_reason,
                validation.diagnostic.map(|diagnostic| diagnostic.message),
            );
            false
        })
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_page_load(move |_, payload| {
            let Some(active_session_id) = browser_embedded_webview_page_load_session_id(
                payload.url().as_str(),
                payload.event(),
            ) else {
                return;
            };
            let status = match payload.event() {
                tauri::webview::PageLoadEvent::Started => BrowserSessionStatus::Loading,
                tauri::webview::PageLoadEvent::Finished => BrowserSessionStatus::Ready,
            };
            spawn_browser_webview_session_patch(
                app_for_load.clone(),
                active_session_id,
                Some(status),
                Some(payload.url().to_string()),
                None,
                None,
                None,
            );
        })
        .on_document_title_changed(move |webview, title| {
            let Ok(current_url) = webview.url() else {
                return;
            };
            let Some(active_session_id) =
                browser_embedded_webview_title_session_id(current_url.as_str())
            else {
                return;
            };
            spawn_browser_webview_session_patch(
                app_for_title.clone(),
                active_session_id,
                None,
                None,
                Some(title),
                None,
                None,
            );
        });

    let parent_window = window.as_ref().window();
    let webview = parent_window
        .add_child(
            webview_builder,
            tauri::LogicalPosition::new(bounds.x, bounds.y),
            tauri::LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|error| error.to_string())?;
    let _ = webview.set_auto_resize(false);
    webview
        .set_bounds(browser_webview_rect(bounds))
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn create_browser_agent_window(
    app: &AppHandle,
    session: &BrowserSession,
    locale: Option<String>,
) -> Result<(), String> {
    let renderer_url: tauri::Url = session
        .normalized_url
        .parse()
        .map_err(|error| format!("Invalid Browser Agent URL: {error}"))?;
    bind_browser_renderer_session(session.browser_session_id.as_str());

    if let Some(window) = app.get_webview_window(BROWSER_RENDERER_WINDOW_LABEL) {
        window
            .close()
            .map_err(|error| format!("Failed to reset Browser Agent window: {error}"))?;
    }
    if current_browser_embedded_webview_session_id().as_deref()
        == Some(session.browser_session_id.as_str())
    {
        if let Some(webview) = app.get_webview(BROWSER_RENDERER_WEBVIEW_LABEL) {
            let _ = webview.close();
        }
        clear_browser_embedded_webview_session(session.browser_session_id.as_str());
    }

    let session_id_for_navigation = session.browser_session_id.clone();
    let workspace_id_for_navigation = session.workspace_id.clone();
    let session_id_for_load = session.browser_session_id.clone();
    let session_id_for_title = session.browser_session_id.clone();
    let app_for_navigation = app.clone();
    let app_for_load = app.clone();
    let app_for_title = app.clone();
    let locale_for_load = locale.clone();
    let locale_for_title = locale.clone();

    let renderer_window = WebviewWindowBuilder::new(
        app,
        BROWSER_RENDERER_WINDOW_LABEL,
        WebviewUrl::External(renderer_url),
    )
    .title("Browser Dock")
    .inner_size(1280.0, 900.0)
    .min_inner_size(760.0, 520.0)
    .resizable(true)
    .center()
    .on_navigation(move |target_url| {
        if handle_browser_toolbar_navigation(
            &app_for_navigation,
            target_url.as_str(),
            session_id_for_navigation.as_str(),
            workspace_id_for_navigation.as_str(),
        ) {
            return false;
        }
        if handle_browser_capture_navigation(target_url.as_str()) {
            return false;
        }
        let validation = validate_browser_url_for_workspace(
            target_url.as_str(),
            Some(workspace_id_for_navigation.as_str()),
        );
        if validation.allowed {
            return true;
        }
        spawn_browser_webview_session_patch(
            app_for_navigation.clone(),
            current_browser_renderer_session(session_id_for_navigation.as_str()),
            Some(BrowserSessionStatus::Blocked),
            Some(target_url.to_string()),
            None,
            validation.blocked_reason,
            validation.diagnostic.map(|diagnostic| diagnostic.message),
        );
        false
    })
    .on_new_window(|_, _| NewWindowResponse::Deny)
    .on_page_load(move |window, payload| {
        let status = match payload.event() {
            tauri::webview::PageLoadEvent::Started => BrowserSessionStatus::Loading,
            tauri::webview::PageLoadEvent::Finished => BrowserSessionStatus::Ready,
        };
        let active_session_id = current_browser_renderer_session(session_id_for_load.as_str());
        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
            spawn_browser_toolbar_injection(
                app_for_load.clone(),
                window.clone(),
                active_session_id.clone(),
                Some(payload.url().to_string()),
                None,
                locale_for_load.clone(),
            );
        }
        spawn_browser_webview_session_patch(
            app_for_load.clone(),
            active_session_id,
            Some(status),
            Some(payload.url().to_string()),
            None,
            None,
            None,
        );
    })
    .on_document_title_changed(move |window, title| {
        let window_title = if title.trim().is_empty() {
            "Browser Dock".to_string()
        } else {
            title.clone()
        };
        let _ = window.set_title(window_title.as_str());
        let active_session_id = current_browser_renderer_session(session_id_for_title.as_str());
        spawn_browser_toolbar_injection(
            app_for_title.clone(),
            window.clone(),
            active_session_id.clone(),
            None,
            Some(title.clone()),
            locale_for_title.clone(),
        );
        spawn_browser_webview_session_patch(
            app_for_title.clone(),
            active_session_id,
            None,
            None,
            Some(title),
            None,
            None,
        );
    })
    .build()
    .map_err(|error| format!("Failed to open Browser Agent window: {error}"))?;
    spawn_browser_toolbar_injection(
        app.clone(),
        renderer_window.clone(),
        session.browser_session_id.clone(),
        Some(session.normalized_url.clone()),
        session.title.clone(),
        locale,
    );
    if let Some(dock_window) = app.get_webview_window(BROWSER_DOCK_WINDOW_LABEL) {
        let _ = dock_window.close();
    }
    let _ = renderer_window.set_focus();
    Ok(())
}
