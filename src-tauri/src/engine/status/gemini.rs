use super::*;

/// Detect Gemini CLI installation status
pub async fn detect_gemini_status(custom_bin: Option<&str>) -> EngineStatus {
    if !crate::engine_policy::GEMINI_RUNTIME_ENABLED {
        return disabled_engine_status(EngineType::Gemini);
    }

    let bin_path = resolve_bin_path("gemini", custom_bin);
    let bin = bin_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "gemini".to_string());
    let path_env = build_codex_path_env(custom_bin);

    let (installed, version, error) = probe_cli_version(&bin, "gemini", path_env.as_ref()).await;

    if !installed {
        return not_installed_status(EngineType::Gemini, error);
    }

    let home_dir = get_gemini_home_dir();
    let models = get_gemini_models();
    let default_model = models.iter().find(|m| m.default).map(|m| m.id.clone());

    EngineStatus {
        engine_type: EngineType::Gemini,
        auth_state: crate::engine::AuthState::default(),
        installed: true,
        version,
        bin_path: Some(bin.to_string()),
        home_dir: home_dir.map(|p| p.to_string_lossy().to_string()),
        models,
        default_model,
        features: EngineFeatures::gemini(),
        error: None,
    }
}

/// Get Gemini home directory
pub(crate) fn get_gemini_home_dir() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("GEMINI_CLI_HOME").filter(|v| !v.is_empty()) {
        let configured = PathBuf::from(home);
        let configured_text = configured.to_string_lossy();
        if configured_text == "~" {
            return dirs::home_dir();
        }
        if let Some(relative) = configured_text
            .strip_prefix("~/")
            .or_else(|| configured_text.strip_prefix("~\\"))
            .filter(|value| !value.is_empty())
        {
            return dirs::home_dir().map(|home| home.join(relative));
        }
        return Some(configured);
    }
    dirs::home_dir().map(|home| home.join(".gemini"))
}

/// Get Gemini CLI available models (stable defaults + preview model).
pub(crate) fn get_gemini_models() -> Vec<ModelInfo> {
    let mut models = get_generated_fallback_models(EngineType::Gemini);

    if let Some(configured_model) = read_configured_gemini_model() {
        for model in &mut models {
            model.default = false;
        }
        if let Some(existing_index) = models.iter().position(|model| model.id == configured_model) {
            let mut existing = models.remove(existing_index);
            existing.default = true;
            models.insert(0, existing);
        } else {
            models.insert(
                0,
                ModelInfo::new(configured_model.clone(), configured_model)
                    .as_default()
                    .with_provider("google")
                    .with_description("Configured in Gemini vendor settings"),
            );
        }
    }

    models
}

pub(crate) fn read_configured_gemini_model() -> Option<String> {
    if let Some(from_config) = read_gemini_model_from_ccgui_config() {
        return Some(from_config);
    }
    std::env::var("GEMINI_MODEL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(crate) fn read_gemini_model_from_ccgui_config() -> Option<String> {
    let config_path = app_paths::config_file_path().ok()?;
    let content = std::fs::read_to_string(config_path).ok()?;
    let root = serde_json::from_str::<Value>(&content).ok()?;
    parse_gemini_model_from_config_json(&root)
}

pub(crate) fn parse_gemini_model_from_config_json(root: &Value) -> Option<String> {
    root.get("gemini")?
        .get("env")?
        .get("GEMINI_MODEL")?
        .as_str()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
