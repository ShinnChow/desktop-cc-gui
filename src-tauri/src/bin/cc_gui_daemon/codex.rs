// Provide feature-style module paths for shared cores when compiled in the daemon.
pub(crate) type WorkspaceSession = crate::backend::app_server::WorkspaceSession;
pub(crate) use crate::codex_doctor::{
    dsh_node_requirement_error, node_satisfies_dsh_requirement,
    run_claude_doctor_with_settings, run_codex_doctor_with_settings,
    run_dsh_doctor_with_settings, run_grok_doctor_with_settings, run_kimi_doctor_with_settings,
    run_opencode_doctor_with_settings, run_pi_doctor_with_settings,
    run_qoder_doctor_for_profile_with_settings, run_qoder_doctor_with_settings,
};
pub(crate) use crate::codex_installer::{
    build_cli_install_plan_with_backend, resolve_cli_version_status,
    run_cli_installer_with_progress, CliInstallBackend, CliInstallProgressEvent,
};
pub(crate) async fn ensure_codex_session(
    _workspace_id: &str,
    _state: &crate::state::AppState,
    _app: &tauri::AppHandle,
) -> Result<(), String> {
    Err("runtime control commands are unavailable in daemon mode".to_string())
}
pub(crate) mod args {
    pub(crate) use crate::codex_args::*;
}
pub(crate) mod config {
    pub(crate) use crate::codex_config::*;
}
pub(crate) mod home {
    pub(crate) use crate::codex_home::*;
}
pub(crate) mod launch_profile {
    pub(crate) use crate::codex_launch_profile::*;
}
pub(crate) mod provider_env {
    pub(crate) use crate::codex_provider_env::*;
}
pub(crate) mod provider_profile {
    use crate::session_management::CodexProviderBinding;
    use crate::types::CodexCustomModel;

    pub(crate) const CODEX_DISK_PROVIDER_PROFILE_ID: &str = "__disk__";
    pub(crate) const CODEX_DISK_PROVIDER_PROFILE_NAME: &str = "codex-tui/default-config";

    pub(crate) fn codex_provider_binding_for_profile_id(
        provider_profile_id: &str,
    ) -> CodexProviderBinding {
        let provider_profile_id = provider_profile_id.trim();
        if provider_profile_id.is_empty()
            || provider_profile_id == CODEX_DISK_PROVIDER_PROFILE_ID
        {
            return CodexProviderBinding {
                provider_profile_id: CODEX_DISK_PROVIDER_PROFILE_ID.to_string(),
                provider_profile_source: "disk".to_string(),
                provider_profile_name: CODEX_DISK_PROVIDER_PROFILE_NAME.to_string(),
                provider_availability: "available".to_string(),
            };
        }
        CodexProviderBinding {
            provider_profile_id: provider_profile_id.to_string(),
            provider_profile_source: "managed".to_string(),
            provider_profile_name: provider_profile_id.to_string(),
            provider_availability: "unavailable".to_string(),
        }
    }

    pub(crate) fn codex_runtime_key(workspace_id: &str, provider_profile_id: &str) -> String {
        let provider_profile_id = provider_profile_id.trim();
        let provider_profile_id = if provider_profile_id.is_empty() {
            CODEX_DISK_PROVIDER_PROFILE_ID
        } else {
            provider_profile_id
        };
        format!("codex::{workspace_id}::{provider_profile_id}")
    }

    pub(crate) fn legacy_codex_runtime_key(workspace_id: &str) -> String {
        workspace_id.to_string()
    }

    pub(crate) fn resolve_codex_provider_model_config(
        provider_profile_id: &str,
    ) -> Result<Option<(String, Vec<CodexCustomModel>)>, String> {
        let provider_profile_id = provider_profile_id.trim();
        if provider_profile_id.is_empty()
            || provider_profile_id == CODEX_DISK_PROVIDER_PROFILE_ID
        {
            return Ok(None);
        }
        let path = crate::app_paths::config_file_path()?;
        let content = std::fs::read_to_string(&path).map_err(|error| {
            format!("failed to read provider config {}: {error}", path.display())
        })?;
        let config: serde_json::Value = serde_json::from_str(&content).map_err(|error| {
            format!(
                "failed to parse provider config {}: {error}",
                path.display()
            )
        })?;
        let provider = config
            .get("codex")
            .and_then(|codex| codex.get("providers"))
            .and_then(|providers| providers.get(provider_profile_id))
            .ok_or_else(|| format!("Codex provider {provider_profile_id} not found"))?;
        let provider_name = provider
            .get("name")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(provider_profile_id);
        let config_toml = provider
            .get("configToml")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if config_toml.is_empty() {
            return Err(format!(
                "Codex provider {provider_name} has empty configToml"
            ));
        }
        let custom_models = provider
            .get("customModels")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| {
                format!("Codex provider {provider_name} has invalid customModels: {error}")
            })?
            .unwrap_or_default();
        Ok(Some((config_toml, custom_models)))
    }
}
pub(crate) mod rewind {
    pub(crate) use crate::codex_rewind::*;
}
pub(crate) mod collaboration_policy {
    pub(crate) use crate::codex_collaboration_policy::*;
}
pub(crate) mod thread_mode_state {
    pub(crate) use crate::codex_thread_mode_state::*;
}

