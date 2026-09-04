pub(crate) const THINKING_LEVELS: &[&str] = &["off", "minimal", "low", "medium", "high", "xhigh", "max"];

pub(crate) fn resolve_model_flag(model: Option<&str>) -> Option<String> {
    let trimmed = model.map(str::trim).filter(|v| !v.is_empty())?;
    let lower = trimmed.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "__config_default__"
            | "auto"
            | "default"
            | "(default)"
            | "config-default"
            | "config_default"
            | "pi-default"
            | "pi default"
    ) {
        return None;
    }
    Some(trimmed.to_string())
}

/// Split a `provider/modelId` catalog id. Model ids may themselves contain
/// slashes (e.g. openrouter `openai/gpt-4o` → `openrouter/openai/gpt-4o`),
/// so only the FIRST segment is the provider.
pub(crate) fn split_provider_model(value: &str) -> Option<(String, String)> {
    let (provider, model_id) = value.split_once('/')?;
    let provider = provider.trim();
    let model_id = model_id.trim();
    if provider.is_empty() || model_id.is_empty() {
        return None;
    }
    Some((provider.to_string(), model_id.to_string()))
}

/// Reconcile plan for the resident's model vs the requested model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RpcModelReconcile {
    /// No explicit model requested (auto/default): resident keeps whatever
    /// the pi config default resolved to.
    Skip,
    /// Resident already runs the requested model.
    Match,
    /// Resident runs a different model: `set_model` before prompting.
    Set { provider: String, model_id: String },
    /// Bare model id (no provider prefix) that does not match the resident:
    /// `set_model` needs an explicit provider, so we cannot reconcile
    /// precisely — warn and keep the resident model.
    BareMismatch(String),
}

pub(crate) fn plan_rpc_model_reconcile(
    desired: Option<&str>,
    current: Option<(&str, &str)>,
) -> RpcModelReconcile {
    let Some(desired) = desired else {
        return RpcModelReconcile::Skip;
    };
    match split_provider_model(desired) {
        Some((provider, model_id)) => {
            if current == Some((provider.as_str(), model_id.as_str())) {
                RpcModelReconcile::Match
            } else {
                RpcModelReconcile::Set { provider, model_id }
            }
        }
        None => match current {
            Some((_, model_id)) if model_id == desired => RpcModelReconcile::Match,
            _ => RpcModelReconcile::BareMismatch(desired.to_string()),
        },
    }
}

// Session ids are passed as a CLI flag value; restrict to a conservative
// charset so a hostile or corrupted id (e.g. "-x") is never parsed as a flag.
pub(crate) fn is_valid_pi_session_id_arg(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub(crate) fn resolve_thinking_flag(effort: Option<&str>) -> Option<String> {
    pick_thinking_level(effort, None)
}

/// Prefer the model-specific allowlist from `get_available_thinking_levels`.
/// Fall back to the static CLI list when the resident has not reported one.
pub(crate) fn pick_thinking_level(effort: Option<&str>, available: Option<&[String]>) -> Option<String> {
    let normalized = effort?.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    if let Some(levels) = available.filter(|levels| !levels.is_empty()) {
        return levels
            .iter()
            .find(|level| level.eq_ignore_ascii_case(&normalized))
            .cloned();
    }
    THINKING_LEVELS
        .iter()
        .find(|level| **level == normalized)
        .map(|level| (*level).to_string())
}
