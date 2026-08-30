//! 身份/键解析：attempt owner 校验、runtime identity / scope 键构造、
//! native session identity 归一化与 engine token。

use super::*;

pub(crate) fn validate_owner(owner: &SharedRuntimeAttemptOwner) -> Result<(), String> {
    for (field, value) in [
        ("workspaceId", owner.workspace_id.as_str()),
        ("providerRuntimeKey", owner.provider_runtime_key.as_str()),
        ("sharedSessionId", owner.shared_session_id.as_str()),
        ("sharedThreadId", owner.shared_thread_id.as_str()),
        ("logicalTurnId", owner.logical_turn_id.as_str()),
        ("attemptId", owner.attempt_id.as_str()),
        ("bindingKey", owner.binding_key.as_str()),
        ("bindingOperationId", owner.binding_operation_id.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(format!("shared runtime owner {field} cannot be empty"));
        }
    }
    if owner.shared_thread_id != format!("shared:{}", owner.shared_session_id) {
        return Err("shared runtime owner session/thread identity mismatch".to_string());
    }
    if owner.execution_target_snapshot.engine != engine_token(owner.engine) {
        return Err("shared runtime owner execution target engine mismatch".to_string());
    }
    if let Some(marker) = owner.context_marker.as_ref() {
        if marker.package_id.trim().is_empty() || marker.source_checksum.trim().is_empty() {
            return Err("shared runtime context marker cannot be empty".to_string());
        }
    }
    Ok(())
}

pub(crate) fn same_durable_owner(left: &SharedRuntimeAttemptOwner, right: &SharedRuntimeAttemptOwner) -> bool {
    left.workspace_id == right.workspace_id
        && left.provider_runtime_key == right.provider_runtime_key
        && left.shared_session_id == right.shared_session_id
        && left.shared_thread_id == right.shared_thread_id
        && left.logical_turn_id == right.logical_turn_id
        && left.attempt_id == right.attempt_id
        && left.binding_key == right.binding_key
        && left.binding_operation_id == right.binding_operation_id
        && left.engine == right.engine
        && left.execution_target_snapshot == right.execution_target_snapshot
        && left.context_marker == right.context_marker
}

pub(crate) fn insert_identity_owner(
    index: &mut HashMap<RuntimeIdentityKey, String>,
    key: RuntimeIdentityKey,
    attempt_id: &str,
) -> Result<(), String> {
    if let Some(existing) = index.get(&key) {
        if existing != attempt_id {
            return Err(format!(
                "shared runtime identity already owned by attempt {existing}"
            ));
        }
    }
    index.insert(key, attempt_id.to_string());
    Ok(())
}

pub(crate) fn identity_key(owner: &SharedRuntimeAttemptOwner, identity: &str) -> RuntimeIdentityKey {
    RuntimeIdentityKey {
        workspace_id: owner.workspace_id.clone(),
        engine: owner.engine,
        provider_runtime_key: owner.provider_runtime_key.clone(),
        identity: identity.to_string(),
    }
}

pub(crate) fn runtime_scope_key(owner: &SharedRuntimeAttemptOwner) -> RuntimeScopeKey {
    RuntimeScopeKey {
        workspace_id: owner.workspace_id.clone(),
        engine: owner.engine,
        provider_runtime_key: owner.provider_runtime_key.clone(),
    }
}

pub(crate) fn runtime_scope_key_for_ingress(ingress: &RuntimeIngress) -> RuntimeScopeKey {
    RuntimeScopeKey {
        workspace_id: ingress.workspace_id.clone(),
        engine: ingress.engine,
        provider_runtime_key: ingress.provider_runtime_key.clone(),
    }
}

pub(crate) fn native_identity_key_for_ingress(ingress: &RuntimeIngress) -> Option<RuntimeIdentityKey> {
    ingress
        .native_session_id
        .as_deref()
        .map(|native_session_id| RuntimeIdentityKey {
            workspace_id: ingress.workspace_id.clone(),
            engine: ingress.engine,
            provider_runtime_key: ingress.provider_runtime_key.clone(),
            identity: native_session_id.to_string(),
        })
}

pub(crate) fn normalize_identity(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

pub(crate) fn normalize_native_session_identity(
    engine: EngineType,
    provider_runtime_key: Option<&str>,
    value: Option<&str>,
) -> Option<String> {
    let normalized = normalize_identity(value)?;
    // Claude / Kimi / Grok / OpenCode：catalog 与 FE hide 使用 `engine:{raw}`。
    // Codex 保持 raw thread id（无前缀）。pending 占位原样保留，避免误写成
    // `grok:grok-pending-shared-*`。
    match engine {
        EngineType::Claude
        | EngineType::Kimi
        | EngineType::Pi
        | EngineType::Grok
        | EngineType::OpenCode => {
            let token = engine_token(engine);
            let prefix = format!("{token}:");
            if crate::shared_sessions::is_pending_shared_binding_thread_id(engine, normalized) {
                return Some(normalized.to_string());
            }
            let raw = normalized
                .strip_prefix(prefix.as_str())
                .unwrap_or(normalized)
                .trim();
            if raw.is_empty() {
                return None;
            }
            if crate::shared_sessions::is_pending_shared_binding_thread_id(engine, raw) {
                return Some(raw.to_string());
            }
            Some(format!("{prefix}{raw}"))
        }
        EngineType::Qoder => {
            if crate::shared_sessions::is_pending_shared_binding_thread_id(engine, normalized) {
                return Some(normalized.to_string());
            }
            let provider_profile_id = provider_runtime_key.and_then(
                crate::engine::qoder_provider_profile::qoder_provider_profile_id_from_runtime_key,
            );
            let identity =
                crate::engine::qoder_provider_profile::parse_qoder_native_session_identity(
                    normalized,
                    provider_profile_id,
                )
                .ok()?;
            // Runtime ingress 的 raw ACP session id 没有 distribution。只有明确
            // 的 Qoder runtime key 才能把它升格为 durable Native identity；canonical
            // identity 自带 profile，可用于兼容已经落盘的历史事件。
            if provider_profile_id.is_none() && identity.is_legacy {
                return None;
            }
            Some(identity.canonical_id())
        }
        EngineType::Codex | EngineType::Gemini | EngineType::Dsh => Some(normalized.to_string()),
    }
}

pub(crate) fn is_missing_native_session_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("no conversation found with session id")
        || normalized.contains("conversation not found for session id")
}

pub(crate) fn engine_token(engine: EngineType) -> &'static str {
    match engine {
        EngineType::Claude => "claude",
        EngineType::Codex => "codex",
        EngineType::Gemini => "gemini",
        EngineType::OpenCode => "opencode",
        EngineType::Kimi => "kimi",
        EngineType::Pi => "pi",
        EngineType::Grok => "grok",
        EngineType::Dsh => "dsh",
        EngineType::Qoder => "qoder",
    }
}
