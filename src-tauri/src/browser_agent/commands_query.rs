use super::*;

#[tauri::command]
pub(crate) async fn get_browser_agent_settings(
    state: State<'_, AppState>,
) -> Result<BrowserAgentSettings, String> {
    Ok(current_settings(&state).await)
}

#[tauri::command]
pub(crate) async fn get_browser_agent_platform_capability(
) -> Result<BrowserPlatformCapability, String> {
    Ok(platform::current_platform_capability())
}

#[tauri::command]
pub(crate) async fn validate_browser_agent_url(
    url: String,
    workspace_id: Option<String>,
) -> Result<BrowserUrlValidationResult, String> {
    Ok(validate_browser_url_for_workspace(
        url.as_str(),
        workspace_id.as_deref(),
    ))
}

#[tauri::command]
pub(crate) async fn route_browser_agent_provider(
    requested_capability: String,
    user_override: bool,
    state: State<'_, AppState>,
) -> Result<BrowserProviderRouteDecision, String> {
    let settings = current_settings(&state).await;
    Ok(default_route_decision(
        requested_capability.as_str(),
        &settings,
        user_override,
        &platform::current_platform_capability(),
    ))
}

#[tauri::command]
pub(crate) async fn get_browser_agent_status(
    state: State<'_, AppState>,
) -> Result<BrowserAgentStatus, String> {
    let settings = current_settings(&state).await;
    Ok(BrowserAgentStatus {
        feature_phase: if settings.enabled {
            BrowserAgentFeaturePhase::ReadOnlySnapshot
        } else {
            BrowserAgentFeaturePhase::Disabled
        },
        platform_capability: platform::current_platform_capability(),
        provider_preference: default_route_decision(
            "read_snapshot",
            &settings,
            false,
            &platform::current_platform_capability(),
        ),
        settings,
    })
}
