use super::*;

/// Detect Claude Code CLI installation status
pub async fn detect_claude_status(custom_bin: Option<&str>) -> EngineStatus {
    let bin_path = resolve_bin_path("claude", custom_bin);
    let bin = bin_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "claude".to_string());
    let path_env = build_codex_path_env(custom_bin);

    // B2 版本去重：find_claude_code_binary 的候选验证已 spawn 过 `claude
    // --version`（结果在进程级 memo），同轮检测直接复用，不再二次探测。
    let memoized_version = bin_path.as_deref().and_then(claude_cached_version_text);
    let (mut installed, mut version, mut error) = match memoized_version {
        Some(text) => (true, Some(text), None),
        None => probe_cli_version(&bin, "claude", path_env.as_ref()).await,
    };

    if !installed && probe_cli_help(&bin, path_env.as_ref()).await {
        installed = true;
        if version.is_none() {
            version = Some("unknown".to_string());
        }
        error = None;
    }

    if !installed {
        return not_installed_status(EngineType::Claude, error);
    }

    let home_dir = get_claude_home_dir();
    let models = get_claude_models(&bin, path_env.as_ref()).await;
    let default_model = models.iter().find(|m| m.default).map(|m| m.id.clone());

    EngineStatus {
        engine_type: EngineType::Claude,
        auth_state: crate::engine::AuthState::default(),
        installed: true,
        version,
        bin_path: Some(bin.to_string()),
        home_dir: home_dir.map(|p| p.to_string_lossy().to_string()),
        models,
        default_model,
        features: EngineFeatures::claude(),
        error: None,
    }
}

/// Get Claude Code home directory
pub(crate) fn get_claude_home_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".claude"))
}

/// Built-in Claude Code model catalog (mirrors the CLI `/model` roster).
///
/// The Claude CLI does not expose a model-list RPC, so this catalog is
/// hardcoded like `get_codex_models`. Settings/env overrides rewrite each
/// tier's runtime model + display name via `apply_claude_model_overrides`
/// (tier ids stay unique so the picker can keep one row per family).
pub(crate) fn get_builtin_claude_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo::new("claude-fable-5", "Fable 5")
            .with_provider("anthropic")
            .with_protocol("anthropic-messages")
            .with_provenance("curated:claude-builtin")
            .with_description("Fable 5 · Most powerful · Mythos-class")
            .with_source("builtin"),
        ModelInfo::new("claude-opus-5", "Opus 5")
            .as_default()
            .with_provider("anthropic")
            .with_protocol("anthropic-messages")
            .with_provenance("curated:claude-builtin")
            .with_description("Opus 5 · Latest Opus upgrade")
            .with_source("builtin"),
        ModelInfo::new("claude-sonnet-5", "Sonnet 5")
            .with_provider("anthropic")
            .with_protocol("anthropic-messages")
            .with_provenance("curated:claude-builtin")
            .with_description("Sonnet 5 · Upgraded Sonnet model")
            .with_source("builtin"),
        ModelInfo::new("claude-haiku-4-5-20251001", "Haiku 4.5")
            .with_provider("anthropic")
            .with_protocol("anthropic-messages")
            .with_provenance("curated:claude-builtin")
            .with_description("Haiku 4.5 · Fastest for quick answers")
            .with_source("builtin"),
    ]
}

/// Build Claude model list.
///
/// Priority:
/// 1. Local Claude settings (`~/.claude/settings.json`) and env overrides
/// 2. Built-in catalog (see `get_builtin_claude_models`)
/// 3. Frontend user custom models (merged in the webview layer)
///
/// `claude --help` examples are intentionally not treated as a model catalog:
/// they are documentation snippets, not the current provider's configured list.
pub(crate) async fn get_claude_models(_bin: &str, _path_env: Option<&String>) -> Vec<ModelInfo> {
    let mut models = get_builtin_claude_models();
    apply_claude_model_overrides(&mut models, read_claude_model_overrides());
    ensure_default_model(&mut models);
    dedupe_models_preserve_order(models)
}

#[derive(Default, Clone)]
pub(crate) struct ClaudeModelOverrides {
    pub(crate) main: Option<String>,
    pub(crate) fable: Option<String>,
    pub(crate) sonnet: Option<String>,
    pub(crate) opus: Option<String>,
    pub(crate) haiku: Option<String>,
    pub(crate) reasoning: Option<String>,
}

pub(crate) fn normalize_non_empty(input: Option<String>) -> Option<String> {
    input.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

pub(crate) fn read_claude_model_overrides() -> ClaudeModelOverrides {
    let mut overrides = ClaudeModelOverrides {
        main: normalize_non_empty(std::env::var("ANTHROPIC_MODEL").ok()),
        fable: normalize_non_empty(std::env::var("ANTHROPIC_DEFAULT_FABLE_MODEL").ok()),
        sonnet: normalize_non_empty(std::env::var("ANTHROPIC_DEFAULT_SONNET_MODEL").ok()),
        opus: normalize_non_empty(std::env::var("ANTHROPIC_DEFAULT_OPUS_MODEL").ok()),
        haiku: normalize_non_empty(std::env::var("ANTHROPIC_DEFAULT_HAIKU_MODEL").ok()),
        reasoning: normalize_non_empty(std::env::var("ANTHROPIC_REASONING_MODEL").ok()),
    };

    if let Some(file_overrides) = read_claude_model_overrides_from_settings() {
        if file_overrides.main.is_some() {
            overrides.main = file_overrides.main;
        }
        if file_overrides.fable.is_some() {
            overrides.fable = file_overrides.fable;
        }
        if file_overrides.sonnet.is_some() {
            overrides.sonnet = file_overrides.sonnet;
        }
        if file_overrides.opus.is_some() {
            overrides.opus = file_overrides.opus;
        }
        if file_overrides.haiku.is_some() {
            overrides.haiku = file_overrides.haiku;
        }
        if file_overrides.reasoning.is_some() {
            overrides.reasoning = file_overrides.reasoning;
        }
    }

    overrides
}

pub(crate) fn read_claude_model_overrides_from_settings() -> Option<ClaudeModelOverrides> {
    let path = get_claude_home_dir()?.join("settings.json");
    let content = std::fs::read_to_string(path).ok()?;
    let root = serde_json::from_str::<Value>(&content).ok()?;
    let env = root.get("env")?;
    Some(ClaudeModelOverrides {
        main: normalize_non_empty(
            env.get("ANTHROPIC_MODEL")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        ),
        fable: normalize_non_empty(
            env.get("ANTHROPIC_DEFAULT_FABLE_MODEL")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        ),
        sonnet: normalize_non_empty(
            env.get("ANTHROPIC_DEFAULT_SONNET_MODEL")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        ),
        opus: normalize_non_empty(
            env.get("ANTHROPIC_DEFAULT_OPUS_MODEL")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        ),
        haiku: normalize_non_empty(
            env.get("ANTHROPIC_DEFAULT_HAIKU_MODEL")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        ),
        reasoning: normalize_non_empty(
            env.get("ANTHROPIC_REASONING_MODEL")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        ),
    })
}

/// Infer Claude model family for ANTHROPIC_DEFAULT_* slot resolution.
pub(crate) fn claude_model_family_key(model_id: &str) -> Option<&'static str> {
    let normalized = model_id.to_ascii_lowercase();
    if normalized.contains("fable") {
        return Some("fable");
    }
    if normalized.contains("haiku") {
        return Some("haiku");
    }
    if normalized.contains("sonnet") {
        return Some("sonnet");
    }
    if normalized.contains("opus") {
        return Some("opus");
    }
    None
}

pub(crate) fn resolve_override_for_family<'a>(
    family: &str,
    overrides: &'a ClaudeModelOverrides,
) -> Option<&'a str> {
    let tier = match family {
        "fable" => overrides.fable.as_deref(),
        "haiku" => overrides.haiku.as_deref(),
        "sonnet" => overrides.sonnet.as_deref(),
        "opus" => overrides.opus.as_deref(),
        _ => None,
    };
    tier.or(overrides.main.as_deref())
}

/// Apply settings/env model mapping onto the builtin tier catalog.
///
/// Keeps stable catalog ids (claude-opus-5, …) so the UI can still present
/// one row per family with the original tier description, while rewriting:
/// - `model` (runtime id sent to CLI)
/// - `name` / displayName (what the picker shows when mapping is active)
///
/// This matches jetbrains-cc-gui: mapping changes labels, not the tier list.
pub(crate) fn apply_claude_model_overrides(models: &mut Vec<ModelInfo>, overrides: ClaudeModelOverrides) {
    let has_any = overrides.main.is_some()
        || overrides.fable.is_some()
        || overrides.sonnet.is_some()
        || overrides.opus.is_some()
        || overrides.haiku.is_some();
    if !has_any {
        return;
    }

    for model in models.iter_mut() {
        let Some(family) = claude_model_family_key(&model.id) else {
            continue;
        };
        let Some(mapped) = resolve_override_for_family(family, &overrides) else {
            continue;
        };
        model.model = mapped.to_string();
        model.name = mapped.to_string();
        model.provenance = Some("settings:claude-model-override".to_string());
        // Keep builtin tier descriptions so the subtitle still explains the family.
        if model.source == "builtin" || model.source.is_empty() {
            model.source = "settings-mapped".to_string();
        }
    }
}
