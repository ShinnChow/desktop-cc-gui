use super::*;

pub(crate) fn percent_decode_browser_capture(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = &value[index + 1..index + 3];
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                decoded.push(byte);
                index += 3;
                continue;
            }
        }
        decoded.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

pub(crate) fn parse_browser_capture_navigation(target_url: &str) -> Option<BrowserCaptureNavigationChunk> {
    let prefix = format!("https://{BROWSER_CAPTURE_BRIDGE_HOST}{BROWSER_CAPTURE_BRIDGE_PATH}?");
    let query = target_url.strip_prefix(prefix.as_str())?;
    let mut token = None;
    let mut browser_session_id = None;
    let mut index = None;
    let mut total = None;
    let mut payload = None;
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        match key {
            "token" => token = Some(percent_decode_browser_capture(value)),
            "session" => browser_session_id = Some(percent_decode_browser_capture(value)),
            "index" => index = value.parse::<usize>().ok(),
            "total" => total = value.parse::<usize>().ok(),
            "payload" => payload = Some(value.to_string()),
            _ => {}
        }
    }
    Some(BrowserCaptureNavigationChunk {
        token: token?,
        browser_session_id: browser_session_id?,
        index: index?,
        total: total?,
        payload: payload?,
    })
}

pub(crate) fn handle_browser_capture_navigation(target_url: &str) -> bool {
    let Some(chunk) = parse_browser_capture_navigation(target_url) else {
        return false;
    };
    if chunk.total == 0 || chunk.total > 256 || chunk.index >= chunk.total {
        return true;
    }
    if let Ok(mut bridge) = browser_capture_bridge().lock() {
        let entry = bridge
            .entry(chunk.token)
            .or_insert_with(|| BrowserCaptureBridgeState {
                browser_session_id: chunk.browser_session_id.clone(),
                chunks: vec![None; chunk.total],
            });
        if entry.browser_session_id == chunk.browser_session_id && entry.chunks.len() == chunk.total
        {
            entry.chunks[chunk.index] = Some(chunk.payload);
        }
    }
    true
}

pub(crate) fn take_browser_capture_payload(token: &str) -> Option<String> {
    let mut bridge = browser_capture_bridge().lock().ok()?;
    let entry = bridge.get(token)?;
    if entry.chunks.iter().any(|chunk| chunk.is_none()) {
        return None;
    }
    let encoded = entry
        .chunks
        .iter()
        .filter_map(|chunk| chunk.as_deref())
        .collect::<String>();
    bridge.remove(token);
    let decoded = URL_SAFE_NO_PAD.decode(encoded.as_bytes()).ok()?;
    String::from_utf8(decoded).ok()
}

pub(crate) fn cleanup_browser_capture_payload(token: &str) {
    if let Ok(mut bridge) = browser_capture_bridge().lock() {
        bridge.remove(token);
    }
}

pub(crate) fn escape_js_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

pub(crate) fn browser_capture_bridge_script(browser_session_id: &str, token: &str) -> String {
    let capture_script = capture_script::READ_ONLY_CAPTURE_SCRIPT;
    let session = escape_js_string(browser_session_id);
    let capture_token = escape_js_string(token);
    format!(
        r#"
(() => {{
  const sessionId = {session};
  const token = {capture_token};
  const chunkSize = {BROWSER_CAPTURE_CHUNK_SIZE};
  const bridgeBase = "https://{BROWSER_CAPTURE_BRIDGE_HOST}{BROWSER_CAPTURE_BRIDGE_PATH}";
  const toBase64Url = (value) => {{
    const bytes = typeof TextEncoder === "function"
      ? new TextEncoder().encode(value)
      : Array.from(unescape(encodeURIComponent(value))).map((char) => char.charCodeAt(0));
    let binary = "";
    bytes.forEach((byte) => {{
      binary += String.fromCharCode(byte);
    }});
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }};
  try {{
    const facts = {capture_script};
    const encoded = toBase64Url(JSON.stringify(facts || {{}}));
    const chunks = encoded.match(new RegExp(".{{1," + chunkSize + "}}", "g")) || [""];
    chunks.forEach((chunk, index) => {{
      window.setTimeout(() => {{
        const url = bridgeBase
          + "?token=" + encodeURIComponent(token)
          + "&session=" + encodeURIComponent(sessionId)
          + "&index=" + index
          + "&total=" + chunks.length
          + "&payload=" + chunk;
        window.location.href = url;
      }}, index * 35);
    }});
  }} catch (error) {{
    const fallback = toBase64Url(JSON.stringify({{
      title: document.title || null,
      url: location.href,
      visibleText: "",
      captureError: error && error.message ? String(error.message) : "capture_failed"
    }}));
    window.location.href = bridgeBase
      + "?token=" + encodeURIComponent(token)
      + "&session=" + encodeURIComponent(sessionId)
      + "&index=0&total=1&payload=" + fallback;
  }}
}})();
"#
    )
}

pub(crate) async fn capture_browser_webview_dom(
    app: &AppHandle,
    browser_session_id: &str,
) -> Result<BrowserRawCapture, String> {
    let token = format!("browser-capture-{}", uuid::Uuid::new_v4());
    let script = browser_capture_bridge_script(browser_session_id, token.as_str());
    eval_browser_renderer_script(app, browser_session_id, script).map_err(|error| {
        format!("failed to run Browser Agent read-only capture script: {error}")
    })?;
    for _ in 0..BROWSER_CAPTURE_WAIT_ATTEMPTS {
        if let Some(payload) = take_browser_capture_payload(token.as_str()) {
            return serde_json::from_str::<BrowserRawCapture>(payload.as_str()).map_err(|error| {
                format!("failed to parse Browser Agent capture payload: {error}")
            });
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    cleanup_browser_capture_payload(token.as_str());
    Err("Browser Agent read-only capture timed out.".to_string())
}
