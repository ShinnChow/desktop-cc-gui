use super::*;

pub(crate) struct BrowserTabContextMenuLabels {
    close_current: &'static str,
    close_others: &'static str,
    close_right: &'static str,
    close_all: &'static str,
}

pub(crate) fn browser_tab_context_menu_overlay_script(
    browser_session_id: &str,
    nonce: &str,
    x: f64,
    locale: Option<&str>,
    disabled_actions: &[String],
    theme: &BrowserTabContextMenuTheme,
) -> Result<String, String> {
    let labels = browser_tab_context_menu_labels(locale);
    let session_id =
        serde_json::to_string(browser_session_id).map_err(|error| error.to_string())?;
    let nonce = serde_json::to_string(nonce).map_err(|error| error.to_string())?;
    let theme = serde_json::to_string(theme).map_err(|error| error.to_string())?;
    let items = serde_json::to_string(&[
        (
            "current",
            labels.close_current,
            disabled_actions.iter().any(|action| action == "current"),
        ),
        (
            "others",
            labels.close_others,
            disabled_actions.iter().any(|action| action == "others"),
        ),
        (
            "right",
            labels.close_right,
            disabled_actions.iter().any(|action| action == "right"),
        ),
        (
            "all",
            labels.close_all,
            disabled_actions.iter().any(|action| action == "all"),
        ),
    ])
    .map_err(|error| error.to_string())?;
    let x = x.max(12.0);

    Ok(format!(
        r#"(() => {{
  const cleanupKey = "__mossxBrowserTabMenuCleanup";
  if (typeof window[cleanupKey] === "function") {{
    window[cleanupKey]();
  }}
  const host = document.createElement("div");
  host.id = "mossx-browser-tab-context-menu";
  host.setAttribute("data-mossx-browser-tab-menu", "true");
  const setHostStyle = (property, value) => host.style.setProperty(property, value, "important");
  setHostStyle("all", "initial");
  setHostStyle("position", "fixed");
  setHostStyle("inset", "0");
  setHostStyle("z-index", "2147483647");
  setHostStyle("display", "block");
  setHostStyle("visibility", "visible");
  setHostStyle("opacity", "1");
  setHostStyle("transform", "none");
  setHostStyle("pointer-events", "none");
  const shadow = host.attachShadow({{ mode: "closed" }});
  const root = document.createElement("div");
  root.id = "mossx-browser-tab-context-menu-root";
  root.setAttribute("role", "menu");
  root.setAttribute("aria-label", "Browser tab actions");
  root.style.cssText = [
    "position:fixed", "z-index:2147483647", "left:min({x}px, calc(100vw - 272px))",
    "top:{BROWSER_TAB_CONTEXT_MENU_TOP_OFFSET}px", "width:248px", "box-sizing:border-box",
    "padding:8px", "border:1px solid var(--mossx-tab-menu-border)", "border-radius:16px",
    "background:var(--mossx-tab-menu-surface)",
    "font:500 16px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", "color:var(--mossx-tab-menu-foreground)",
    "pointer-events:auto", "isolation:isolate"
  ].join(";");
  const theme = {theme};
  root.style.colorScheme = theme.colorScheme;
  root.style.setProperty("--mossx-tab-menu-surface", theme.surface);
  root.style.setProperty("--mossx-tab-menu-foreground", theme.foreground);
  root.style.setProperty("--mossx-tab-menu-border", theme.border);
  root.style.setProperty("--mossx-tab-menu-hover", theme.hoverSurface);
  root.style.setProperty("--mossx-tab-menu-disabled-foreground", theme.disabledForeground);
  if (theme.shadow !== "none") root.style.boxShadow = "0 18px 48px " + theme.shadow;
  const close = () => {{
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("keydown", onKeyDown, true);
    host.remove();
    delete window[cleanupKey];
  }};
  const onPointerDown = (event) => {{
    if (!event.composedPath().includes(host)) close();
  }};
  const onKeyDown = (event) => {{
    if (event.key === "Escape") close();
  }};
  const sessionId = {session_id};
  const menuNonce = {nonce};
  const actions = {items};
  for (const [action, label, disabled] of actions) {{
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.setAttribute("role", "menuitem");
    button.disabled = disabled;
    button.setAttribute("aria-disabled", String(disabled));
    button.textContent = label;
    button.style.cssText = "display:block;width:100%;min-height:42px;padding:0 12px;border:0;border-radius:9px;background:transparent;color:" + (disabled ? "var(--mossx-tab-menu-disabled-foreground)" : "var(--mossx-tab-menu-foreground)") + ";text-align:left;font:inherit;cursor:" + (disabled ? "not-allowed" : "pointer");
    button.onmouseenter = () => {{ if (!disabled) button.style.background = "var(--mossx-tab-menu-hover)"; }};
    button.onmouseleave = () => {{ if (!disabled) button.style.background = "transparent"; }};
    button.onclick = () => {{
      if (disabled) return;
      close();
      window.location.assign("https://{BROWSER_TAB_CONTEXT_MENU_BRIDGE_HOST}{BROWSER_TAB_CONTEXT_MENU_BRIDGE_PATH}?action=" + encodeURIComponent(action) + "&browserSessionId=" + encodeURIComponent(sessionId) + "&nonce=" + encodeURIComponent(menuNonce));
    }};
    root.appendChild(button);
  }}
  shadow.appendChild(root);
  (document.body || document.documentElement).appendChild(host);
  window[cleanupKey] = close;
  setTimeout(() => document.addEventListener("pointerdown", onPointerDown, true), 0);
  window.addEventListener("keydown", onKeyDown, true);
}})();"#,
    ))
}

pub(crate) fn handle_browser_tab_context_menu_navigation(app: &AppHandle, target_url: &str) -> bool {
    let Ok(url) = target_url.parse::<tauri::Url>() else {
        return false;
    };
    if url.host_str() != Some(BROWSER_TAB_CONTEXT_MENU_BRIDGE_HOST)
        || url.path() != BROWSER_TAB_CONTEXT_MENU_BRIDGE_PATH
    {
        return false;
    }
    let mut action = None;
    let mut browser_session_id = None;
    let mut nonce = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "action" => action = Some(value.into_owned()),
            "browserSessionId" => browser_session_id = Some(value.into_owned()),
            "nonce" => nonce = Some(value.into_owned()),
            _ => {}
        }
    }
    let (Some(action), Some(browser_session_id), Some(nonce)) = (action, browser_session_id, nonce)
    else {
        return true;
    };
    let Some(renderer_browser_session_id) = current_browser_embedded_webview_session_id() else {
        return true;
    };
    if matches!(action.as_str(), "current" | "others" | "right" | "all")
        && consume_browser_tab_context_menu_invocation(
            nonce.as_str(),
            browser_session_id.as_str(),
            renderer_browser_session_id.as_str(),
            unix_time_ms(),
        )
    {
        let _ = app.emit(
            BROWSER_TAB_CONTEXT_MENU_EVENT,
            BrowserTabContextMenuAction {
                browser_session_id,
                action,
            },
        );
    }
    true
}

pub(crate) fn browser_tab_context_menu_labels(locale: Option<&str>) -> BrowserTabContextMenuLabels {
    if locale.unwrap_or_default().starts_with("zh") {
        return BrowserTabContextMenuLabels {
            close_current: "关闭标签页",
            close_others: "关闭其他标签页",
            close_right: "关闭右侧标签页",
            close_all: "关闭全部标签页",
        };
    }
    BrowserTabContextMenuLabels {
        close_current: "Close tab",
        close_others: "Close other tabs",
        close_right: "Close tabs to the right",
        close_all: "Close all tabs",
    }
}
