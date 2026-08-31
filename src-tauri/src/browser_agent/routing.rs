use super::*;

pub(crate) fn default_route_decision(
    requested_capability: &str,
    settings: &BrowserAgentSettings,
    user_override: bool,
    platform_capability: &BrowserPlatformCapability,
) -> BrowserProviderRouteDecision {
    if !settings.enabled {
        return BrowserProviderRouteDecision {
            requested_capability: requested_capability.to_string(),
            selected_provider: "browser_skill".to_string(),
            reason: "Browser Agent is disabled in settings.".to_string(),
            user_override,
            fallback_used: settings.allow_external_provider_fallback,
            fallback_reason: Some("browser_agent_disabled".to_string()),
        };
    }

    if user_override {
        return BrowserProviderRouteDecision {
            requested_capability: requested_capability.to_string(),
            selected_provider: "browser_skill".to_string(),
            reason: "User explicitly opted out of the built-in Browser Agent.".to_string(),
            user_override,
            fallback_used: true,
            fallback_reason: Some("user_override".to_string()),
        };
    }

    if !settings.prefer_for_ai_browser_operations {
        return BrowserProviderRouteDecision {
            requested_capability: requested_capability.to_string(),
            selected_provider: "browser_skill".to_string(),
            reason: "Browser Agent is enabled but not preferred for AI browser operations."
                .to_string(),
            user_override,
            fallback_used: settings.allow_external_provider_fallback,
            fallback_reason: Some("browser_agent_not_preferred".to_string()),
        };
    }

    let capability_state = match requested_capability {
        "read_snapshot" => &platform_capability.snapshot_capture,
        "navigate" | "reload" | "scroll" => &platform_capability.navigation_actions,
        "click" | "type" => &platform_capability.element_actions,
        "submit" | "full_agent_task" => &platform_capability.form_submit_actions,
        _ => &BrowserCapabilityState::Unsupported,
    };
    if *capability_state == BrowserCapabilityState::Unsupported {
        return BrowserProviderRouteDecision {
            requested_capability: requested_capability.to_string(),
            selected_provider: "browser_skill".to_string(),
            reason: "Browser Agent platform capability is unsupported for this operation."
                .to_string(),
            user_override,
            fallback_used: settings.allow_external_provider_fallback,
            fallback_reason: Some("platform_unsupported".to_string()),
        };
    }

    let phase_blocked = match requested_capability {
        "read_snapshot" => !settings.allow_read_only_snapshots,
        "navigate" | "reload" | "scroll" => !settings.allow_navigation_actions,
        "click" | "type" => !settings.allow_element_actions,
        "submit" | "full_agent_task" => !settings.allow_form_submit_actions,
        _ => true,
    };
    if phase_blocked {
        return BrowserProviderRouteDecision {
            requested_capability: requested_capability.to_string(),
            selected_provider: "browser_skill".to_string(),
            reason: "Browser Agent feature phase blocks this operation.".to_string(),
            user_override,
            fallback_used: settings.allow_external_provider_fallback,
            fallback_reason: Some("phase_blocked".to_string()),
        };
    }

    BrowserProviderRouteDecision {
        requested_capability: requested_capability.to_string(),
        selected_provider: "built_in_browser_agent".to_string(),
        reason: "Browser Agent is enabled and preferred for AI browser operations.".to_string(),
        user_override,
        fallback_used: false,
        fallback_reason: None,
    }
}
