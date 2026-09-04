use super::*;

/// Detect Kimi CLI installation status
pub async fn detect_kimi_status(custom_bin: Option<&str>) -> EngineStatus {
    let bin_path = resolve_bin_path("kimi", custom_bin);
    let bin = bin_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "kimi".to_string());
    let path_env = build_codex_path_env(custom_bin);

    let (installed, version, error) = probe_cli_version(&bin, "kimi", path_env.as_ref()).await;

    if !installed {
        return not_installed_status(EngineType::Kimi, error);
    }

    let home_dir = get_kimi_home_dir();
    let (models, config_diagnostic) = get_kimi_models(home_dir.as_deref());
    let default_model = models.iter().find(|m| m.default).map(|m| m.id.clone());

    EngineStatus {
        engine_type: EngineType::Kimi,
        auth_state: crate::engine::AuthState::default(),
        installed: true,
        version,
        bin_path: Some(bin.to_string()),
        home_dir: home_dir.map(|p| p.to_string_lossy().to_string()),
        models,
        default_model,
        features: EngineFeatures::kimi(),
        error: config_diagnostic,
    }
}

/// Get Kimi home directory
pub(crate) fn get_kimi_home_dir() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("KIMI_CODE_HOME").filter(|v| !v.is_empty()) {
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
    dirs::home_dir().map(|home| home.join(".kimi-code"))
}

/// Built-in fallback models used when `~/.kimi-code/config.toml` is missing
/// or has no `[models]` table yet (e.g. fresh install before first run).
pub(crate) fn get_builtin_kimi_models() -> Vec<ModelInfo> {
    get_generated_fallback_models(EngineType::Kimi)
}

/// Get Kimi CLI available models by parsing `$KIMI_CODE_HOME/config.toml`.
/// Falls back to the built-in catalog when the config file is missing or
/// defines no models.
pub(crate) fn get_kimi_models(home_dir: Option<&std::path::Path>) -> (Vec<ModelInfo>, Option<String>) {
    let (mut models, config_diagnostic) = match read_kimi_models_from_config(home_dir) {
        Ok(models) => (models.unwrap_or_default(), None),
        Err(error) => (Vec::new(), Some(error)),
    };

    // KIMI_MODEL_NAME synthesizes a temporary model that takes priority over
    // default_model in config.toml (mirrors the CLI's own precedence).
    if let Ok(env_model) = std::env::var("KIMI_MODEL_NAME") {
        let env_model = env_model.trim().to_string();
        if !env_model.is_empty() {
            for model in &mut models {
                model.default = false;
            }
            if let Some(index) = models.iter().position(|model| model.id == env_model) {
                let mut existing = models.remove(index);
                existing.default = true;
                models.insert(0, existing);
            } else {
                let display = std::env::var("KIMI_MODEL_DISPLAY_NAME")
                    .ok()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| env_model.clone());
                models.insert(
                    0,
                    ModelInfo::new(env_model, display)
                        .as_default()
                        .with_provider("kimi")
                        .with_protocol("kimi")
                        .with_provenance("env:KIMI_MODEL_NAME")
                        .with_observed_at(model_catalog_now_ms())
                        .with_description("Configured via KIMI_MODEL_NAME")
                        .with_source("env"),
                );
            }
        }
    }

    if models.is_empty() {
        return (get_builtin_kimi_models(), config_diagnostic);
    }
    (models, config_diagnostic)
}

/// Parse `[models.*]` entries and `default_model` from kimi's config.toml.
pub(crate) fn read_kimi_models_from_config(
    home_dir: Option<&std::path::Path>,
) -> Result<Option<Vec<ModelInfo>>, String> {
    let Some(home_dir) = home_dir else {
        return Ok(None);
    };
    let config_path = home_dir.join("config.toml");
    let content = match std::fs::read_to_string(&config_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Kimi config io-error at {}: {}",
                config_path.display(),
                error
            ))
        }
    };
    let root = content.parse::<toml::Value>().map_err(|error| {
        format!(
            "Kimi config malformed at {}: {}",
            config_path.display(),
            error
        )
    })?;
    let default_alias = root
        .get("default_model")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let Some(models_table) = root.get("models").and_then(|value| value.as_table()) else {
        return Ok(Some(Vec::new()));
    };

    let mut models = Vec::new();
    for (alias, entry) in models_table {
        let display_name = entry
            .get("display_name")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| {
                entry
                    .get("model")
                    .and_then(|value| value.as_str())
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
            })
            .unwrap_or_else(|| alias.clone());
        let provider = entry
            .get("provider")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let mut info = ModelInfo::new(alias.clone(), display_name)
            .with_protocol("kimi-config")
            .with_provenance("config:KIMI_CODE_HOME/config.toml")
            .with_observed_at(model_catalog_now_ms())
            .with_source("config");
        if let Some(provider) = provider {
            info = info.with_provider(provider);
        }
        if default_alias.as_deref() == Some(alias.as_str()) {
            info = info.as_default();
        }
        models.push(info);
    }
    models.sort_by(|a, b| a.id.cmp(&b.id));
    if let Some(index) = models.iter().position(|model| model.default) {
        let default = models.remove(index);
        models.insert(0, default);
    }
    Ok(Some(models))
}
