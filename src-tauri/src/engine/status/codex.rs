use super::*;

/// Detect Codex CLI installation status
pub async fn detect_codex_status(custom_bin: Option<&str>) -> EngineStatus {
    let Some(bin_path) = resolve_bin_path("codex", custom_bin) else {
        return not_installed_status(
            EngineType::Codex,
            Some("Codex CLI not found during startup detection".to_string()),
        );
    };
    let bin = bin_path.to_string_lossy().to_string();

    let home_dir = get_codex_home_dir();
    let models = get_codex_models();
    let default_model = models.iter().find(|m| m.default).map(|m| m.id.clone());

    EngineStatus {
        engine_type: EngineType::Codex,
        auth_state: crate::engine::AuthState::default(),
        installed: true,
        version: None,
        bin_path: Some(bin.to_string()),
        home_dir: home_dir.map(|p| p.to_string_lossy().to_string()),
        models,
        default_model,
        features: EngineFeatures::codex(),
        error: None,
    }
}

/// Get Codex home directory
pub(crate) fn get_codex_home_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".codex"))
}

/// Get Codex CLI available models (hardcoded as they don't change frequently)
pub(crate) fn get_codex_models() -> Vec<ModelInfo> {
    get_generated_fallback_models(EngineType::Codex)
}
