use super::*;

/// Detect Grok CLI installation status
pub async fn detect_grok_status(custom_bin: Option<&str>) -> EngineStatus {
    let bin_path = resolve_bin_path("grok", custom_bin);
    let bin = bin_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "grok".to_string());
    let path_env = build_codex_path_env(custom_bin);

    let (installed, version, error) = probe_cli_version(&bin, "grok", path_env.as_ref()).await;

    if !installed {
        return not_installed_status(EngineType::Grok, error);
    }

    let home_dir = get_grok_home_dir();
    let (models, config_diagnostic) = get_grok_models(home_dir.as_deref());
    let default_model = models.iter().find(|m| m.default).map(|m| m.id.clone());

    EngineStatus {
        engine_type: EngineType::Grok,
        auth_state: crate::engine::AuthState::default(),
        installed: true,
        version,
        bin_path: Some(bin.to_string()),
        home_dir: home_dir.map(|p| p.to_string_lossy().to_string()),
        models,
        default_model,
        features: EngineFeatures::grok(),
        error: config_diagnostic,
    }
}

/// Get Grok home directory
pub(crate) fn get_grok_home_dir() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("GROK_HOME").filter(|v| !v.is_empty()) {
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
    dirs::home_dir().map(|home| home.join(".grok"))
}

/// Built-in fallback models used when `~/.grok/config.toml` is missing
/// or has no `[model]` tables yet (e.g. fresh install before first run).
pub(crate) fn get_builtin_grok_models() -> Vec<ModelInfo> {
    get_generated_fallback_models(EngineType::Grok)
}

/// Get Grok CLI available models by parsing `$GROK_HOME/config.toml`.
/// Falls back to the built-in catalog when the config file is missing or
/// defines no models.
pub(crate) fn get_grok_models(home_dir: Option<&std::path::Path>) -> (Vec<ModelInfo>, Option<String>) {
    let (models, config_diagnostic) = match read_grok_models_from_config(home_dir) {
        Ok(models) => (models.unwrap_or_default(), None),
        Err(error) => (Vec::new(), Some(error)),
    };

    if models.is_empty() {
        return (get_builtin_grok_models(), config_diagnostic);
    }
    (models, config_diagnostic)
}

/// Parse `[model.*]` entries and `[models].default` from grok's config.toml.
pub(crate) fn read_grok_models_from_config(
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
                "Grok config io-error at {}: {}",
                config_path.display(),
                error
            ))
        }
    };
    let root = content.parse::<toml::Value>().map_err(|error| {
        format!(
            "Grok config malformed at {}: {}",
            config_path.display(),
            error
        )
    })?;
    let default_alias = root
        .get("models")
        .and_then(|value| value.get("default"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let Some(models_table) = root.get("model").and_then(|value| value.as_table()) else {
        return Ok(Some(Vec::new()));
    };

    let mut models = Vec::new();
    for (alias, entry) in models_table {
        let display_name = entry
            .get("name")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| alias.clone());
        // Grok's `-m/--model` resolves a `[model.<alias>]` section (or a
        // built-in model name), NOT the section's inner `model` field. Keep
        // `ModelInfo.model` equal to the alias so the composer sends the
        // alias and the CLI resolves base_url/api_key from the config
        // section (same alias semantics as kimi's `--model`).
        let mut info = ModelInfo::new(alias.clone(), display_name)
            .with_protocol("grok-config")
            .with_provenance("config:GROK_HOME/config.toml")
            .with_observed_at(model_catalog_now_ms())
            .with_source("config");
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
