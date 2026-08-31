use super::*;

pub(crate) const BROWSER_WEBVIEW_EVENT: &str = "browser-agent://webview-event";
pub(crate) const BROWSER_RENDERER_WEBVIEW_LABEL: &str = "browser-agent-webview-main";
pub(crate) const BROWSER_RENDERER_WINDOW_LABEL: &str = "browser-agent-window";
pub(crate) const BROWSER_DOCK_WINDOW_LABEL: &str = "browser-agent-dock";
pub(crate) const BROWSER_CAPTURE_BRIDGE_HOST: &str = "browser-agent-capture.invalid";
pub(crate) const BROWSER_CAPTURE_BRIDGE_PATH: &str = "/__mossx_capture__";
pub(crate) const BROWSER_CAPTURE_CHUNK_SIZE: usize = 1_600;
pub(crate) const BROWSER_CAPTURE_WAIT_ATTEMPTS: usize = 80;
pub(crate) const BROWSER_TAB_CONTEXT_MENU_EVENT: &str = "browser-agent://tab-context-action";
pub(crate) const BROWSER_TAB_CONTEXT_MENU_BRIDGE_HOST: &str = "browser-agent-tab-menu.invalid";
pub(crate) const BROWSER_TAB_CONTEXT_MENU_BRIDGE_PATH: &str = "/__mossx_tab_context_menu__";
pub(crate) const BROWSER_TAB_CONTEXT_MENU_TOP_OFFSET: f64 = 16.0;
pub(crate) const BROWSER_TAB_CONTEXT_MENU_BRIDGE_TTL_MS: u64 = 60_000;

static BROWSER_RENDERER_SESSION_ID: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static BROWSER_EMBEDDED_WEBVIEW_BINDING: OnceLock<Mutex<Option<EmbeddedBrowserWebviewBinding>>> =
    OnceLock::new();
static BROWSER_CAPTURE_BRIDGE: OnceLock<Mutex<HashMap<String, BrowserCaptureBridgeState>>> =
    OnceLock::new();
static BROWSER_TAB_CONTEXT_MENU_INVOCATION: OnceLock<
    Mutex<Option<BrowserTabContextMenuInvocation>>,
> = OnceLock::new();

#[derive(Debug, Clone)]
pub(crate) struct BrowserCaptureBridgeState {
pub(crate)     browser_session_id: String,
pub(crate)     chunks: Vec<Option<String>>,
}

#[derive(Debug, Clone)]
pub(crate) struct BrowserCaptureNavigationChunk {
pub(crate)     token: String,
pub(crate)     browser_session_id: String,
pub(crate)     index: usize,
pub(crate)     total: usize,
pub(crate)     payload: String,
}

/// 每个 tab 菜单仅有一个短时、一次性的 native bridge 授权。target session 可与
/// renderer session 不同，因为用户可在当前 A 页面上右键非活动 B tab。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BrowserTabContextMenuInvocation {
pub(crate)     nonce: String,
pub(crate)     target_browser_session_id: String,
pub(crate)     renderer_browser_session_id: String,
pub(crate)     issued_at: u64,
}

impl BrowserTabContextMenuInvocation {
pub(crate)     fn new(
        target_browser_session_id: &str,
        renderer_browser_session_id: &str,
        issued_at: u64,
    ) -> Self {
        Self {
            nonce: format!("browser-tab-menu-{}", uuid::Uuid::new_v4()),
            target_browser_session_id: target_browser_session_id.to_string(),
            renderer_browser_session_id: renderer_browser_session_id.to_string(),
            issued_at,
        }
    }

pub(crate)     fn authorizes(
        &self,
        nonce: &str,
        target_browser_session_id: &str,
        renderer_browser_session_id: &str,
        now: u64,
    ) -> bool {
        self.nonce == nonce
            && self.target_browser_session_id == target_browser_session_id
            && self.renderer_browser_session_id == renderer_browser_session_id
            && now >= self.issued_at
            && now - self.issued_at <= BROWSER_TAB_CONTEXT_MENU_BRIDGE_TTL_MS
    }
}

/// 唯一 embedded renderer 的回调归属事实。native callback 是异步共享通道，不能只用
/// “当前 session”猜测归属；必须同时确认页面 URL 与本次绑定一致。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EmbeddedBrowserWebviewBinding {
pub(crate)     browser_session_id: String,
pub(crate)     expected_url: String,
pub(crate)     load_started: bool,
}

impl EmbeddedBrowserWebviewBinding {
pub(crate)     fn navigating_to(browser_session_id: &str, expected_url: &str) -> Self {
        Self {
            browser_session_id: browser_session_id.to_string(),
            expected_url: expected_url.to_string(),
            load_started: false,
        }
    }

pub(crate)     fn accepts_page_load(
        &mut self,
        callback_url: &str,
        event: tauri::webview::PageLoadEvent,
    ) -> Option<String> {
        if !browser_webview_urls_match(self.expected_url.as_str(), callback_url) {
            return None;
        }
        match event {
            tauri::webview::PageLoadEvent::Started => self.load_started = true,
            tauri::webview::PageLoadEvent::Finished if !self.load_started => return None,
            tauri::webview::PageLoadEvent::Finished => {}
        }
        Some(self.browser_session_id.clone())
    }

pub(crate)     fn accepts_title(&self, callback_url: &str) -> Option<String> {
        (self.load_started && browser_webview_urls_match(self.expected_url.as_str(), callback_url))
            .then(|| self.browser_session_id.clone())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserTabContextMenuAction {
pub(crate)     browser_session_id: String,
pub(crate)     action: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserRawCapture {
pub(crate)     title: Option<String>,
pub(crate)     url: Option<String>,
pub(crate)     selected_text: Option<String>,
pub(crate)     viewport: Option<BrowserViewportState>,
pub(crate)     visible_text: Option<String>,
    #[serde(default)]
pub(crate)     headings: Vec<BrowserTextNode>,
    #[serde(default)]
pub(crate)     links: Vec<BrowserActionTarget>,
    #[serde(default)]
pub(crate)     buttons: Vec<BrowserActionTarget>,
    #[serde(default)]
pub(crate)     forms: Vec<BrowserFormSummary>,
    #[serde(default)]
pub(crate)     content_regions: Vec<BrowserContentRegion>,
pub(crate)     page_type: Option<BrowserPageType>,
pub(crate)     primary_content: Option<BrowserPrimaryContent>,
    #[serde(default)]
pub(crate)     readable_blocks: Vec<BrowserReadableBlock>,
    #[serde(default)]
pub(crate)     noise_diagnostics: Vec<BrowserNoiseDiagnostic>,
    #[serde(default)]
pub(crate)     visual_evidence: Vec<BrowserVisualEvidence>,
    #[serde(default)]
pub(crate)     omitted_capabilities: Vec<String>,
pub(crate)     language_hint: Option<String>,
}

pub(crate) fn browser_renderer_session_binding() -> &'static Mutex<Option<String>> {
    BROWSER_RENDERER_SESSION_ID.get_or_init(|| Mutex::new(None))
}

pub(crate) fn browser_embedded_webview_binding() -> &'static Mutex<Option<EmbeddedBrowserWebviewBinding>> {
    BROWSER_EMBEDDED_WEBVIEW_BINDING.get_or_init(|| Mutex::new(None))
}

pub(crate) fn browser_capture_bridge() -> &'static Mutex<HashMap<String, BrowserCaptureBridgeState>> {
    BROWSER_CAPTURE_BRIDGE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn browser_tab_context_menu_invocation() -> &'static Mutex<Option<BrowserTabContextMenuInvocation>>
{
    BROWSER_TAB_CONTEXT_MENU_INVOCATION.get_or_init(|| Mutex::new(None))
}

pub(crate) fn register_browser_tab_context_menu_invocation(invocation: BrowserTabContextMenuInvocation) {
    if let Ok(mut active_invocation) = browser_tab_context_menu_invocation().lock() {
        *active_invocation = Some(invocation);
    }
}

pub(crate) fn consume_browser_tab_context_menu_invocation(
    nonce: &str,
    target_browser_session_id: &str,
    renderer_browser_session_id: &str,
    now: u64,
) -> bool {
    let Ok(mut active_invocation) = browser_tab_context_menu_invocation().lock() else {
        return false;
    };
    consume_tab_context_menu_invocation(
        &mut active_invocation,
        nonce,
        target_browser_session_id,
        renderer_browser_session_id,
        now,
    )
}

pub(crate) fn consume_tab_context_menu_invocation(
    active_invocation: &mut Option<BrowserTabContextMenuInvocation>,
    nonce: &str,
    target_browser_session_id: &str,
    renderer_browser_session_id: &str,
    now: u64,
) -> bool {
    let is_authorized = active_invocation
        .as_ref()
        .map(|invocation| {
            invocation.authorizes(
                nonce,
                target_browser_session_id,
                renderer_browser_session_id,
                now,
            )
        })
        .unwrap_or(false);
    if is_authorized {
        *active_invocation = None;
    }
    is_authorized
}

pub(crate) fn clear_browser_tab_context_menu_invocation(nonce: &str) {
    if let Ok(mut active_invocation) = browser_tab_context_menu_invocation().lock() {
        if active_invocation
            .as_ref()
            .map(|invocation| invocation.nonce == nonce)
            .unwrap_or(false)
        {
            *active_invocation = None;
        }
    }
}

pub(crate) fn invalidate_browser_tab_context_menu_invocation() {
    if let Ok(mut active_invocation) = browser_tab_context_menu_invocation().lock() {
        *active_invocation = None;
    }
}

pub(crate) fn bind_browser_renderer_session(browser_session_id: &str) {
    if let Ok(mut binding) = browser_renderer_session_binding().lock() {
        *binding = Some(browser_session_id.to_string());
    }
}

pub(crate) fn clear_browser_renderer_session(browser_session_id: &str) {
    if let Ok(mut binding) = browser_renderer_session_binding().lock() {
        if binding.as_deref() == Some(browser_session_id) {
            *binding = None;
        }
    }
}

pub(crate) fn browser_webview_urls_match(expected_url: &str, callback_url: &str) -> bool {
    let Ok(mut expected) = expected_url.parse::<tauri::Url>() else {
        return expected_url == callback_url;
    };
    let Ok(mut callback) = callback_url.parse::<tauri::Url>() else {
        return false;
    };
    expected.set_fragment(None);
    callback.set_fragment(None);
    expected == callback
}

pub(crate) fn current_browser_embedded_webview_binding() -> Option<EmbeddedBrowserWebviewBinding> {
    browser_embedded_webview_binding()
        .lock()
        .ok()
        .and_then(|binding| binding.clone())
}

pub(crate) fn begin_browser_embedded_webview_navigation(
    browser_session_id: &str,
    expected_url: &str,
) -> EmbeddedBrowserWebviewBinding {
    // 页面切换后，旧 document 中遗留的菜单 URL 不能在切回同一 renderer 时复用。
    invalidate_browser_tab_context_menu_invocation();
    let next_binding =
        EmbeddedBrowserWebviewBinding::navigating_to(browser_session_id, expected_url);
    if let Ok(mut binding) = browser_embedded_webview_binding().lock() {
        *binding = Some(next_binding.clone());
    }
    next_binding
}

pub(crate) fn restore_browser_embedded_webview_binding(
    binding_to_restore: Option<EmbeddedBrowserWebviewBinding>,
) {
    if let Ok(mut binding) = browser_embedded_webview_binding().lock() {
        *binding = binding_to_restore;
    }
}

pub(crate) fn restore_browser_embedded_webview_session(browser_session_id: &str, expected_url: &str) {
    let mut restored_binding =
        EmbeddedBrowserWebviewBinding::navigating_to(browser_session_id, expected_url);
    // sync bounds 后恢复的是仍保留在同一 native renderer 内的页面，不会重新 navigate。
    restored_binding.load_started = true;
    restore_browser_embedded_webview_binding(Some(restored_binding));
}

pub(crate) fn update_browser_embedded_webview_navigation_target(browser_session_id: &str, expected_url: &str) {
    if let Ok(mut binding) = browser_embedded_webview_binding().lock() {
        let Some(binding) = binding.as_mut() else {
            return;
        };
        if binding.browser_session_id != browser_session_id {
            return;
        }
        binding.expected_url = expected_url.to_string();
        binding.load_started = false;
    }
}

pub(crate) fn clear_browser_embedded_webview_session(browser_session_id: &str) {
    let cleared = {
        let Ok(mut binding) = browser_embedded_webview_binding().lock() else {
            return;
        };
        if binding
            .as_ref()
            .map(|active| active.browser_session_id.as_str())
            == Some(browser_session_id)
        {
            *binding = None;
            true
        } else {
            false
        }
    };
    if cleared {
        invalidate_browser_tab_context_menu_invocation();
    }
}

pub(crate) fn browser_embedded_webview_page_load_session_id(
    callback_url: &str,
    event: tauri::webview::PageLoadEvent,
) -> Option<String> {
    browser_embedded_webview_binding()
        .lock()
        .ok()
        .and_then(|mut binding| binding.as_mut()?.accepts_page_load(callback_url, event))
}

pub(crate) fn browser_embedded_webview_title_session_id(callback_url: &str) -> Option<String> {
    browser_embedded_webview_binding()
        .lock()
        .ok()
        .and_then(|binding| binding.as_ref()?.accepts_title(callback_url))
}

pub(crate) fn current_browser_renderer_session(fallback_session_id: &str) -> String {
    browser_renderer_session_binding()
        .lock()
        .ok()
        .and_then(|binding| binding.clone())
        .unwrap_or_else(|| fallback_session_id.to_string())
}

pub(crate) fn current_browser_embedded_webview_session_id() -> Option<String> {
    current_browser_embedded_webview_binding().map(|binding| binding.browser_session_id)
}

pub(crate) fn settings_from_app_settings(settings: &crate::types::AppSettings) -> BrowserAgentSettings {
    BrowserAgentSettings {
        enabled: settings.browser_agent_enabled,
        prefer_for_ai_browser_operations: settings.browser_agent_prefer_built_in,
        allow_external_provider_fallback: settings.browser_agent_allow_external_provider_fallback,
        ..BrowserAgentSettings::default()
    }
}

pub(crate) async fn current_settings(state: &State<'_, AppState>) -> BrowserAgentSettings {
    let settings = state.app_settings.lock().await;
    settings_from_app_settings(&settings)
}
