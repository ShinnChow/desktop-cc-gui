use super::*;

pub async fn detect_opencode_status_with_options(
    custom_bin: Option<&str>,
    include_models: bool,
) -> EngineStatus {
    let safe_bin = resolve_safe_opencode_binary(custom_bin);
    let bin_path = match safe_bin {
        Ok(path) => Some(path),
        Err(error) if error == "OpenCode CLI not found" => None,
        Err(error) => {
            return not_installed_status(EngineType::OpenCode, Some(error));
        }
    };
    let bin = bin_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "opencode".to_string());
    let path_env = build_codex_path_env(custom_bin);

    let (mut installed, mut version, mut error) =
        probe_opencode_cli_version(&bin, path_env.as_ref()).await;

    // OpenCode CLI in GUI-launched environments can intermittently fail `--version`
    // due to startup env quirks. Use a lightweight second probe to avoid false
    // "not installed" states in engine selector.
    if !installed && probe_opencode_cli_help(&bin, path_env.as_ref()).await {
        installed = true;
        if version.is_none() {
            version = Some("unknown".to_string());
        }
        error = None;
    }

    if !installed {
        return not_installed_status(EngineType::OpenCode, error);
    }

    let home_dir = get_opencode_home_dir();
    let (models, models_error) = if include_models {
        match get_opencode_models(&bin, path_env.as_ref()).await {
            Ok(models) if !models.is_empty() => {
                remember_opencode_runtime_models(&models);
                (models, None)
            }
            Ok(_) => (public_models_for_engine(EngineType::OpenCode), None),
            Err(err) => {
                let fallback = public_models_for_engine(EngineType::OpenCode);
                if fallback.is_empty() {
                    (Vec::new(), Some(err))
                } else {
                    (fallback, None)
                }
            }
        }
    } else {
        // 快照回填撤销：同 PI（乐观选中/默认解析消费权威链路）。
        (Vec::new(), None)
    };
    let default_model = models.iter().find(|m| m.default).map(|m| m.id.clone());

    EngineStatus {
        engine_type: EngineType::OpenCode,
        auth_state: crate::engine::AuthState::default(),
        installed: true,
        version,
        bin_path: Some(bin.to_string()),
        home_dir: home_dir.map(|p| p.to_string_lossy().to_string()),
        models,
        default_model,
        features: EngineFeatures::opencode(),
        error: models_error,
    }
}

/// Detect OpenCode CLI installation status. Probes the CLI model catalog
/// (like the kimi/grok detection paths) so engine selectors can render the
/// model list without a second round trip; falls back to the generated
/// roster when the probe is unavailable.
pub async fn detect_opencode_status(custom_bin: Option<&str>) -> EngineStatus {
    detect_opencode_status_with_options(custom_bin, true).await
}

/// Query OpenCode CLI for available models on demand.
pub async fn load_opencode_models(custom_bin: Option<&str>) -> Result<Vec<ModelInfo>, String> {
    let safe_bin = resolve_safe_opencode_binary(custom_bin)?;
    let bin = safe_bin.to_string_lossy().to_string();
    let path_env = build_codex_path_env(custom_bin);
    let models = get_opencode_models(&bin, path_env.as_ref()).await?;
    remember_opencode_runtime_models(&models);
    Ok(models)
}

/// Get OpenCode home directory
pub(crate) fn get_opencode_home_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".opencode"))
}

/// Candidate OpenCode config file paths in probe order: `$OPENCODE_CONFIG`,
/// then `~/.config/opencode/opencode.json(c)`, then `~/.opencode/opencode.json(c)`.
pub fn opencode_config_candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(config) = std::env::var_os("OPENCODE_CONFIG").filter(|value| !value.is_empty()) {
        candidates.push(PathBuf::from(config));
    }
    if let Some(home) = dirs::home_dir() {
        for file_name in ["opencode.json", "opencode.jsonc"] {
            candidates.push(home.join(".config").join("opencode").join(file_name));
        }
        for file_name in ["opencode.json", "opencode.jsonc"] {
            candidates.push(home.join(".opencode").join(file_name));
        }
    }
    candidates
}

/// Read the first existing OpenCode config document best-effort.
///
/// Returns `(status, path, document, diagnostic)` where status is one of
/// `loaded` / `missing` / `malformed` / `io-error`. JSONC-only syntax
/// (comments, trailing commas) is not stripped; such files report `malformed`
/// and callers should treat dependent checks as inconclusive rather than broken.
pub fn read_opencode_config_document() -> (String, Option<PathBuf>, Value, Option<String>) {
    let Some(path) = opencode_config_candidate_paths()
        .into_iter()
        .find(|candidate| candidate.is_file())
    else {
        return ("missing".to_string(), None, Value::Null, None);
    };
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) => {
            return (
                "io-error".to_string(),
                Some(path.clone()),
                Value::Null,
                Some(format!("Failed to read {}: {}", path.display(), error)),
            )
        }
    };
    if raw.trim().is_empty() {
        return ("loaded".to_string(), Some(path), Value::Null, None);
    }
    match serde_json::from_str::<Value>(&raw) {
        Ok(document) => ("loaded".to_string(), Some(path), document, None),
        Err(error) => (
            "malformed".to_string(),
            Some(path.clone()),
            Value::Null,
            Some(format!("Failed to parse {}: {}", path.display(), error)),
        ),
    }
}

pub(crate) fn opencode_runtime_model_catalog() -> &'static RwLock<Vec<ModelInfo>> {
    OPENCODE_RUNTIME_MODEL_CATALOG.get_or_init(|| RwLock::new(Vec::new()))
}

pub(crate) fn remember_opencode_runtime_models(models: &[ModelInfo]) {
    if models.is_empty() {
        return;
    }
    let mut cached = opencode_runtime_model_catalog()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *cached = models.to_vec();
}

pub(crate) fn cached_opencode_runtime_models() -> Option<Vec<ModelInfo>> {
    let cached = opencode_runtime_model_catalog()
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    (!cached.is_empty()).then(|| cached.clone())
}

pub(crate) fn resolve_opencode_validation_catalog(
    runtime_snapshot: Option<Vec<ModelInfo>>,
    generated_fallback: Vec<ModelInfo>,
) -> Vec<ModelInfo> {
    runtime_snapshot
        .filter(|models| !models.is_empty())
        .unwrap_or(generated_fallback)
}

/// Query OpenCode CLI for available models.
pub(crate) async fn get_opencode_models(
    bin: &str,
    path_env: Option<&String>,
) -> Result<Vec<ModelInfo>, String> {
    let output_result = timeout(OPENCODE_MODELS_TIMEOUT, async {
        let mut cmd = build_async_command(bin);
        if let Some(path) = path_env {
            cmd.env("PATH", path);
        }
        let _native_artifact_lease =
            crate::engine::opencode_native_artifact::OpenCodeNativeArtifactLease::prepare(
                &mut cmd,
            )?;
        cmd.arg("models")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
            .map_err(|error| error.to_string())
    })
    .await;

    let output = match output_result {
        Ok(Ok(out)) => out,
        Ok(Err(err)) => return Err(format!("Failed to execute opencode models: {err}")),
        Err(_) => return Err("Timeout listing OpenCode models".to_string()),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("opencode models failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_opencode_models_output(&stdout))
}

pub(crate) fn parse_opencode_models_output(stdout: &str) -> Vec<ModelInfo> {
    fn strip_ansi_codes(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        let mut chars = input.chars().peekable();
        while let Some(ch) = chars.next() {
            if ch == '\u{1b}' {
                if let Some('[') = chars.peek().copied() {
                    let _ = chars.next();
                    for c in chars.by_ref() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                    continue;
                }
            }
            out.push(ch);
        }
        out
    }

    let clean = strip_ansi_codes(stdout);
    let mut models: Vec<ModelInfo> = clean
        .lines()
        .map(str::trim)
        .filter_map(|line| {
            if line.is_empty() {
                return None;
            }
            line.split_whitespace().find(|token| token.contains('/'))
        })
        .map(|full_id| {
            let (provider, model_id) = full_id.split_once('/').unwrap_or(("opencode", full_id));
            ModelInfo::new(full_id, format_opencode_model_name(provider, model_id))
                .with_provider(provider)
        })
        .collect();

    if models.is_empty() {
        return models;
    }

    let default_index = models
        .iter()
        .position(|m| m.id == "openai/gpt-5.3-codex")
        .or_else(|| models.iter().position(|m| m.id.starts_with("openai/")))
        .unwrap_or(0);

    if let Some(model) = models.get_mut(default_index) {
        model.default = true;
    }

    models
}

pub(crate) fn format_opencode_model_name(provider: &str, model_id: &str) -> String {
    let provider_name = match provider {
        "openai" => "OpenAI",
        "opencode" => "OpenCode",
        _ => provider,
    };
    let model_name = model_id
        .split('-')
        .map(|part| {
            if part.chars().all(|c| c.is_ascii_digit()) {
                part.to_string()
            } else {
                let mut chars = part.chars();
                match chars.next() {
                    Some(first) => {
                        let mut chunk = first.to_uppercase().to_string();
                        chunk.push_str(chars.as_str());
                        chunk
                    }
                    None => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join("-");
    format!("{}/{}", provider_name, model_name)
}
