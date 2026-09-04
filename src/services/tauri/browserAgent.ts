import { invoke } from "@tauri-apps/api/core";
import type {
  BrowserAgentStatus,
  BrowserSession,
  BrowserContextSnapshot,
  BrowserUrlValidationResult,
  CreateBrowserSessionRequest,
  UpdateBrowserSessionRequest,
  BrowserWebviewBounds,
  BrowserWebviewMountRequest,
  BrowserTabContextMenuRequest,
} from "../../features/browser-agent/types";

export async function getBrowserAgentStatus(): Promise<BrowserAgentStatus> {
  return invoke<BrowserAgentStatus>("get_browser_agent_status");
}







export async function validateBrowserAgentUrl(
  url: string,
  workspaceId?: string | null,
): Promise<BrowserUrlValidationResult> {
  return invoke<BrowserUrlValidationResult>("validate_browser_agent_url", {
    url,
    workspaceId,
  });
}

export async function createBrowserAgentSession(
  request: CreateBrowserSessionRequest,
): Promise<BrowserSession> {
  return invoke<BrowserSession>("create_browser_agent_session", { request });
}

export async function listBrowserAgentSessions(
  workspaceId?: string | null,
): Promise<BrowserSession[]> {
  return invoke<BrowserSession[]>("list_browser_agent_sessions", {
    workspaceId,
  });
}

export async function updateBrowserAgentSession(
  request: UpdateBrowserSessionRequest,
): Promise<BrowserSession> {
  return invoke<BrowserSession>("update_browser_agent_session", { request });
}

export async function closeBrowserAgentSession(
  browserSessionId: string,
): Promise<BrowserSession> {
  return invoke<BrowserSession>("close_browser_agent_session", {
    browserSessionId,
  });
}



export async function mountBrowserAgentWebview(
  request: BrowserWebviewMountRequest,
): Promise<BrowserSession> {
  return invoke<BrowserSession>("mount_browser_agent_webview", { request });
}

export async function openBrowserAgentWindow(
  browserSessionId: string,
  locale?: string | null,
): Promise<BrowserSession> {
  return invoke<BrowserSession>("open_browser_agent_window", {
    browserSessionId,
    locale,
  });
}

export async function syncBrowserAgentWebviewBounds(
  browserSessionId: string,
  bounds: BrowserWebviewBounds,
): Promise<void> {
  return invoke<void>("sync_browser_agent_webview_bounds", {
    browserSessionId,
    bounds,
  });
}

export async function hideBrowserAgentWebview(
  browserSessionId: string,
): Promise<void> {
  return invoke<void>("hide_browser_agent_webview", { browserSessionId });
}

export async function showBrowserAgentTabContextMenuOverlay(
  request: BrowserTabContextMenuRequest,
): Promise<void> {
  return invoke<void>("show_browser_agent_tab_context_menu_overlay", { request });
}

export async function startBrowserAgentElementSelect(
  browserSessionId: string,
): Promise<void> {
  return invoke<void>("start_browser_agent_element_select", {
    browserSessionId,
  });
}

export async function stopBrowserAgentElementSelect(
  browserSessionId: string,
): Promise<void> {
  return invoke<void>("stop_browser_agent_element_select", {
    browserSessionId,
  });
}





export async function captureBrowserAgentSnapshot(
  browserSessionId: string,
): Promise<BrowserContextSnapshot> {
  return invoke<BrowserContextSnapshot>("capture_browser_agent_snapshot", {
    browserSessionId,
  });
}








