use super::*;

#[tauri::command]
pub(crate) async fn mount_browser_agent_webview(
    request: BrowserWebviewMountRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BrowserSession, String> {
    let settings = current_settings(&state).await;
    if !settings.enabled {
        return Err("Browser Agent is disabled in settings.".to_string());
    }

    let capability = platform::current_platform_capability();
    if capability.browser_dock == BrowserCapabilityState::Unsupported {
        return Err(capability
            .unsupported_reasons
            .first()
            .cloned()
            .unwrap_or_else(|| {
                "Browser Agent WebView is unsupported on this platform.".to_string()
            }));
    }

    let session = {
        let sessions = state.browser_sessions.lock().await;
        sessions
            .get(request.browser_session_id.as_str())
            .cloned()
            .ok_or_else(|| format!("Browser session not found: {}", request.browser_session_id))?
    };
    if session.status == BrowserSessionStatus::Closed {
        return Err(format!(
            "Browser session is closed: {}",
            session.browser_session_id
        ));
    }

    // PageLoad / title callback 可能紧随 navigate 触发，必须先把唯一 renderer 绑定到
    // 目标 tab；否则回调会把新页面标题和 URL 写回前一个 tab。
    let previous_embedded_binding = current_browser_embedded_webview_binding();
    begin_browser_embedded_webview_navigation(
        session.browser_session_id.as_str(),
        session.normalized_url.as_str(),
    );
    if let Err(error) = create_browser_child_webview(&app, &session, &request.bounds) {
        restore_browser_embedded_webview_binding(previous_embedded_binding);
        return Err(error);
    }
    spawn_browser_webview_session_patch(
        app,
        session.browser_session_id.clone(),
        Some(BrowserSessionStatus::Loading),
        Some(session.normalized_url.clone()),
        None,
        None,
        None,
    );

    let sessions = state.browser_sessions.lock().await;
    sessions
        .get(session.browser_session_id.as_str())
        .cloned()
        .ok_or_else(|| format!("Browser session not found: {}", session.browser_session_id))
}

#[tauri::command]
pub(crate) async fn open_browser_agent_window(
    browser_session_id: String,
    locale: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BrowserSession, String> {
    let settings = current_settings(&state).await;
    if !settings.enabled {
        return Err("Browser Agent is disabled in settings.".to_string());
    }

    let capability = platform::current_platform_capability();
    if capability.browser_dock == BrowserCapabilityState::Unsupported {
        return Err(capability
            .unsupported_reasons
            .first()
            .cloned()
            .unwrap_or_else(|| {
                "Browser Agent window is unsupported on this platform.".to_string()
            }));
    }

    let session = {
        let sessions = state.browser_sessions.lock().await;
        sessions
            .get(browser_session_id.as_str())
            .cloned()
            .ok_or_else(|| format!("Browser session not found: {browser_session_id}"))?
    };
    if session.status == BrowserSessionStatus::Closed {
        return Err(format!(
            "Browser session is closed: {}",
            session.browser_session_id
        ));
    }

    create_browser_agent_window(&app, &session, locale)?;
    spawn_browser_webview_session_patch(
        app,
        session.browser_session_id.clone(),
        Some(BrowserSessionStatus::Loading),
        Some(session.normalized_url.clone()),
        None,
        None,
        None,
    );

    let sessions = state.browser_sessions.lock().await;
    sessions
        .get(session.browser_session_id.as_str())
        .cloned()
        .ok_or_else(|| format!("Browser session not found: {}", session.browser_session_id))
}

#[tauri::command]
pub(crate) async fn sync_browser_agent_webview_bounds(
    browser_session_id: String,
    bounds: BrowserWebviewBounds,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.browser_sessions.lock().await;
        sessions
            .get(browser_session_id.as_str())
            .filter(|session| session.status != BrowserSessionStatus::Closed)
            .cloned()
    };
    let Some(session) = session else {
        return Ok(());
    };

    if let Some(binding) = current_browser_embedded_webview_binding() {
        if binding.browser_session_id != browser_session_id {
            // 旧 effect cleanup / ResizeObserver 可能晚到；它们不得改写当前 tab 的 renderer。
            return Ok(());
        }
    }

    let webview = app
        .get_webview(BROWSER_RENDERER_WEBVIEW_LABEL)
        .ok_or_else(|| format!("Browser Agent WebView not found: {browser_session_id}"))?;
    if !valid_webview_bounds(&bounds) {
        // binding 为空代表 renderer 已被临时隐藏，无需重复 hide。
        if current_browser_embedded_webview_session_id().as_deref()
            == Some(browser_session_id.as_str())
        {
            webview.hide().map_err(|error| error.to_string())?;
            clear_browser_embedded_webview_session(browser_session_id.as_str());
        }
        return Ok(());
    }

    // dock 恢复可见时只同步 bounds；不 navigate，页面状态不丢失。
    webview
        .set_bounds(browser_webview_rect(&bounds))
        .map_err(|error| error.to_string())?;
    if current_browser_embedded_webview_binding().is_none() {
        restore_browser_embedded_webview_session(
            session.browser_session_id.as_str(),
            session.normalized_url.as_str(),
        );
    }
    webview.show().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn hide_browser_agent_webview(
    browser_session_id: String,
    app: AppHandle,
) -> Result<(), String> {
    if current_browser_embedded_webview_session_id().as_deref() != Some(browser_session_id.as_str())
    {
        return Ok(());
    }
    if let Some(webview) = app.get_webview(BROWSER_RENDERER_WEBVIEW_LABEL) {
        webview.hide().map_err(|error| error.to_string())?;
    }
    clear_browser_embedded_webview_session(browser_session_id.as_str());
    Ok(())
}

/// 菜单注入当前 child WebView，和网页处于同一渲染层，不需要 hide 页面。
#[tauri::command]
pub(crate) async fn show_browser_agent_tab_context_menu_overlay(
    request: BrowserTabContextMenuRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !request.x.is_finite() {
        return Err("Invalid Browser Agent tab menu position.".to_string());
    }

    let target_is_live = {
        let sessions = state.browser_sessions.lock().await;
        sessions
            .get(request.browser_session_id.as_str())
            .map(|session| session.status != BrowserSessionStatus::Closed)
            .unwrap_or(false)
    };
    if !target_is_live {
        return Err(format!(
            "Browser session is not available: {}",
            request.browser_session_id
        ));
    }

    let renderer_browser_session_id = current_browser_embedded_webview_session_id()
        .ok_or_else(|| "Browser Agent WebView is not embedded.".to_string())?;
    let webview = app
        .get_webview(BROWSER_RENDERER_WEBVIEW_LABEL)
        .ok_or_else(|| "Browser Agent WebView is not available.".to_string())?;
    let invocation = BrowserTabContextMenuInvocation::new(
        request.browser_session_id.as_str(),
        renderer_browser_session_id.as_str(),
        unix_time_ms(),
    );
    let script = browser_tab_context_menu_overlay_script(
        request.browser_session_id.as_str(),
        invocation.nonce.as_str(),
        request.x,
        request.locale.as_deref(),
        request.disabled_actions.as_slice(),
        &request.theme,
    )?;
    register_browser_tab_context_menu_invocation(invocation.clone());
    if let Err(error) = webview.eval(script) {
        clear_browser_tab_context_menu_invocation(invocation.nonce.as_str());
        return Err(error.to_string());
    }
    Ok(())
}

/// 在内嵌子 webview 中启动元素选择器（浮动窗由注入工具条自行 eval，内嵌无注入工具条）。
/// 选中结果经 bridge URL 由子 webview 的 on_navigation 拦截后回传主窗口。
#[tauri::command]
pub(crate) async fn start_browser_agent_element_select(
    browser_session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.browser_sessions.lock().await;
        sessions
            .get(browser_session_id.as_str())
            .cloned()
            .ok_or_else(|| format!("Browser session not found: {browser_session_id}"))?
    };
    if current_browser_embedded_webview_session_id().as_deref() != Some(browser_session_id.as_str())
    {
        return Err(format!(
            "Browser Agent WebView is not active for session: {browser_session_id}"
        ));
    }
    let webview = app
        .get_webview(BROWSER_RENDERER_WEBVIEW_LABEL)
        .ok_or_else(|| format!("Browser Agent WebView is not embedded: {browser_session_id}"))?;
    let script = browser_element_selector_script(
        session.browser_session_id.as_str(),
        session.workspace_id.as_str(),
        None,
    );
    webview.eval(&script).map_err(|error| error.to_string())
}

/// 退出内嵌元素选择器：只跑页面内 cleanup，不再重新注入选择脚本。
#[tauri::command]
pub(crate) async fn stop_browser_agent_element_select(
    browser_session_id: String,
    app: AppHandle,
) -> Result<(), String> {
    if current_browser_embedded_webview_session_id().as_deref() != Some(browser_session_id.as_str())
    {
        return Err(format!(
            "Browser Agent WebView is not active for session: {browser_session_id}"
        ));
    }
    let webview = app
        .get_webview(BROWSER_RENDERER_WEBVIEW_LABEL)
        .ok_or_else(|| format!("Browser Agent WebView is not embedded: {browser_session_id}"))?;
    webview
        .eval(&browser_element_selector_stop_script())
        .map_err(|error| error.to_string())
}
