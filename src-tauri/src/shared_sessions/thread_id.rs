use crate::engine::EngineType;

pub(crate) fn shared_thread_id(shared_session_id: &str) -> String {
    format!("shared:{shared_session_id}")
}

fn is_safe_shared_session_storage_id(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

pub(crate) fn parse_shared_session_id(thread_id: &str) -> Result<String, String> {
    let normalized = thread_id.trim();
    if let Some(rest) = normalized.strip_prefix("shared:") {
        let shared_session_id = rest.trim();
        if is_safe_shared_session_storage_id(shared_session_id) {
            return Ok(shared_session_id.to_string());
        }
    }
    Err(format!("Invalid shared session thread id: {thread_id}"))
}

pub(crate) fn validate_shared_native_thread_id(value: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        Err("Shared session native thread id cannot be empty".to_string())
    } else {
        Ok(normalized.to_string())
    }
}

pub(crate) fn canonical_shared_native_thread_id(
    engine: EngineType,
    provider_profile_id: Option<&str>,
    native_thread_id: &str,
) -> String {
    let native_thread_id = native_thread_id.trim();
    if native_thread_id.is_empty()
        || engine != EngineType::Qoder
        || is_pending_shared_binding_thread_id(engine, native_thread_id)
    {
        return native_thread_id.to_string();
    }
    match crate::engine::qoder_provider_profile::canonical_qoder_native_session_id(
        native_thread_id,
        provider_profile_id,
    ) {
        Ok(identity) => identity,
        Err(error) => {
            // 保留无法解释的旧值，避免 metadata sanitize 造成数据丢失；下游
            // visibility 会拒绝把它展开为跨 distribution 的 bare raw alias。
            log::warn!(
                "[shared_sessions] retained malformed Qoder native binding `{native_thread_id}`: {error}"
            );
            native_thread_id.to_string()
        }
    }
}

pub(crate) fn is_pending_shared_binding_thread_id(engine: EngineType, thread_id: &str) -> bool {
    let normalized = thread_id.trim();
    if normalized.is_empty() {
        return true;
    }
    match engine {
        EngineType::Claude => normalized.starts_with("claude-pending-shared-"),
        EngineType::Codex => normalized.starts_with("codex-pending-shared-"),
        EngineType::Kimi => normalized.starts_with("kimi-pending-shared-"),
        EngineType::Pi => normalized.starts_with("pi-pending-shared-"),
        EngineType::Grok => normalized.starts_with("grok-pending-shared-"),
        EngineType::OpenCode => normalized.starts_with("opencode-pending-shared-"),
        EngineType::Qoder => normalized.starts_with("qoder-pending-shared-"),
        // omp 不在 Shared 支持集合（add-omp-engine 显式决策），与 gemini/dsh 同形态。
        EngineType::Gemini | EngineType::Dsh | EngineType::Omp => false,
    }
}

pub(crate) fn binding_uses_established_native_thread(engine: EngineType, thread_id: &str) -> bool {
    let normalized = thread_id.trim();
    if normalized.is_empty() || is_pending_shared_binding_thread_id(engine, normalized) {
        return false;
    }
    // 兼容 `engine:{raw}` 与历史 raw id；strip 前缀后再判 pending。
    let raw = match engine {
        EngineType::Claude
        | EngineType::Kimi
        | EngineType::Pi
        | EngineType::Omp
        | EngineType::Grok
        | EngineType::OpenCode
        | EngineType::Dsh
        | EngineType::Qoder => {
            let prefix = format!("{}:", engine.icon());
            normalized
                .strip_prefix(prefix.as_str())
                .unwrap_or(normalized)
                .trim()
        }
        EngineType::Codex | EngineType::Gemini => normalized,
    };
    if raw.is_empty() || is_pending_shared_binding_thread_id(engine, raw) {
        return false;
    }
    match engine {
        EngineType::Claude => normalized.contains(':'),
        EngineType::Codex
        | EngineType::Kimi
        | EngineType::Pi
        | EngineType::Grok
        | EngineType::OpenCode
        | EngineType::Qoder => true,
        EngineType::Gemini | EngineType::Dsh | EngineType::Omp => false,
    }
}

pub(crate) fn engine_binding_thread_id(engine: EngineType, seed: &str) -> String {
    match engine {
        EngineType::Claude => format!("claude-pending-shared-{seed}"),
        EngineType::Codex => format!("codex-pending-shared-{seed}"),
        EngineType::Kimi => format!("kimi-pending-shared-{seed}"),
        EngineType::Pi => format!("pi-pending-shared-{seed}"),
        EngineType::Grok => format!("grok-pending-shared-{seed}"),
        EngineType::OpenCode => format!("opencode-pending-shared-{seed}"),
        EngineType::Gemini => format!("gemini-pending-shared-{seed}"),
        EngineType::Dsh => format!("dsh-pending-shared-{seed}"),
        // Qoder Shared bindings retain their distribution identity; this id is only provisional
        // until the corresponding native session is established.
        EngineType::Qoder => format!("qoder-pending-shared-{seed}"),
        // omp 不进 Shared（add-omp-engine）；arm 仅为保持函数全域性。
        EngineType::Omp => format!("omp-pending-shared-{seed}"),
    }
}

/// Binding Key = Engine + ProviderProfile（Model 不进 Key）。
/// 与前端 `bindingKeyOf` 保持一致：`{engine}:{provider|"default"}`。
pub(crate) fn shared_target_binding_key(
    engine: EngineType,
    provider_profile_id: Option<&str>,
) -> String {
    let provider = provider_profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    format!("{}:{}", engine.icon(), provider.unwrap_or("default"))
}
