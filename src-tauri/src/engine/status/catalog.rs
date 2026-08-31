use super::*;

#[derive(Deserialize)]
pub(crate) struct GeneratedModelCatalog {
    #[serde(rename = "lastVerifiedAt")]
    last_verified_at: String,
    engines: GeneratedModelCatalogEngines,
}

#[derive(Deserialize)]
pub(crate) struct GeneratedModelCatalogEngines {
    codex: Vec<GeneratedModelEntry>,
    gemini: Vec<GeneratedModelEntry>,
    grok: Vec<GeneratedModelEntry>,
    kimi: Vec<GeneratedModelEntry>,
    #[serde(default)]
    opencode: Vec<GeneratedModelEntry>,
    #[serde(default)]
    pi: Vec<GeneratedModelEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeneratedModelEntry {
    id: String,
    label: String,
    #[serde(default)]
    description: String,
    provider: String,
    protocol: String,
    lifecycle: String,
    #[serde(default)]
    default: bool,
}

pub(crate) fn get_generated_fallback_models(engine: EngineType) -> Vec<ModelInfo> {
    let Ok(catalog) = serde_json::from_str::<GeneratedModelCatalog>(GENERATED_MODEL_CATALOG_JSON)
    else {
        log::error!("[model-catalog] generated fallback artifact is invalid");
        return Vec::new();
    };
    let last_verified_at = catalog.last_verified_at;
    let entries = match engine {
        EngineType::Codex => catalog.engines.codex,
        EngineType::Gemini => catalog.engines.gemini,
        EngineType::Grok => catalog.engines.grok,
        EngineType::Kimi => catalog.engines.kimi,
        EngineType::Pi => catalog.engines.pi,
        EngineType::OpenCode => catalog.engines.opencode,
        _ => return Vec::new(),
    };
    entries
        .into_iter()
        .map(|entry| {
            let mut model = ModelInfo::new(entry.id, entry.label)
                .with_description(entry.description)
                .with_provider(entry.provider)
                .with_protocol(entry.protocol)
                .with_provenance("generated:model-catalog")
                .with_fallback_freshness(last_verified_at.clone(), entry.lifecycle)
                .with_source("fallback");
            if entry.default {
                model = model.as_default();
            }
            model
        })
        .collect()
}

pub(crate) fn model_catalog_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn merge_provider_models_with_public(
    provider_models: Vec<ModelInfo>,
    public_models: Vec<ModelInfo>,
) -> Vec<ModelInfo> {
    dedupe_models_preserve_order(provider_models.into_iter().chain(public_models).collect())
}

pub(crate) fn public_models_for_engine(engine_type: EngineType) -> Vec<ModelInfo> {
    match engine_type {
        EngineType::Claude => get_builtin_claude_models(),
        EngineType::Codex | EngineType::Grok | EngineType::Kimi | EngineType::OpenCode => {
            get_generated_fallback_models(engine_type)
        }
        EngineType::Pi => get_generated_fallback_models(engine_type),
        // Qoder catalog is ACP runtime-only (no static fallback roster).
        EngineType::Gemini | EngineType::Dsh | EngineType::Qoder => Vec::new(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UnlistedRuntimeModelPolicy {
    Allow,
    Reject,
}

pub(crate) fn validate_model_catalog_pair(
    model_catalog_entry_id: Option<&str>,
    runtime_model: Option<&str>,
    catalog: &[ModelInfo],
    unlisted_runtime_model_policy: UnlistedRuntimeModelPolicy,
) -> Result<(), String> {
    let model_catalog_entry_id = model_catalog_entry_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let runtime_model = runtime_model
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(entry_id) = model_catalog_entry_id {
        if let Some(entry) = catalog.iter().find(|entry| entry.id.trim() == entry_id) {
            let expected_runtime_model = if entry.model.trim().is_empty() {
                entry.id.trim()
            } else {
                entry.model.trim()
            };
            if runtime_model != Some(expected_runtime_model) {
                return Err(format!(
                    "invalid-target-model: catalog entry '{entry_id}' requires runtime model '{expected_runtime_model}'"
                ));
            }
            return Ok(());
        }
        // Catalog 未登记的自定义 / 自由模型名：Allow 时不拦截用户输入的 model id。
        // Reject 仍 fail-closed（旧 Shared 语义）；调用方若允许自定义应传 Allow。
        if unlisted_runtime_model_policy == UnlistedRuntimeModelPolicy::Allow {
            return Ok(());
        }
        return Err(format!(
            "invalid-target-model: catalog entry '{entry_id}' is unavailable for the selected Provider"
        ));
    }

    let Some(runtime_model) = runtime_model else {
        return Ok(());
    };
    if let Some(entry) = catalog.iter().find(|entry| {
        entry.id.trim() == runtime_model
            && !entry.model.trim().is_empty()
            && entry.model.trim() != runtime_model
    }) {
        return Err(format!(
            "invalid-target-model: '{}' is a catalog entry id; use runtime model '{}'",
            entry.id.trim(),
            entry.model.trim()
        ));
    }
    if catalog
        .iter()
        .any(|entry| entry.model.trim() == runtime_model)
        || unlisted_runtime_model_policy == UnlistedRuntimeModelPolicy::Allow
    {
        return Ok(());
    }
    Err(format!(
        "invalid-target-model: runtime model '{runtime_model}' is unavailable for the selected Provider"
    ))
}

pub(crate) fn get_local_engine_models_for_validation(
    engine_type: EngineType,
) -> Option<Vec<ModelInfo>> {
    match engine_type {
        EngineType::Claude => {
            let mut models = get_builtin_claude_models();
            apply_claude_model_overrides(&mut models, read_claude_model_overrides());
            ensure_default_model(&mut models);
            Some(dedupe_models_preserve_order(models))
        }
        EngineType::Codex => Some(get_codex_models()),
        EngineType::Kimi => Some(get_kimi_models(get_kimi_home_dir().as_deref()).0),
        // PI models are async CLI-probed; callers use detect_pi_status / refresh path.
        EngineType::Pi => Some(get_generated_fallback_models(EngineType::Pi)),
        EngineType::Grok => Some(get_grok_models(get_grok_home_dir().as_deref()).0),
        EngineType::OpenCode => Some(resolve_opencode_validation_catalog(
            cached_opencode_runtime_models(),
            public_models_for_engine(EngineType::OpenCode),
        )),
        // Qoder models come from the live ACP handshake, not a local store.
        EngineType::Gemini | EngineType::Dsh | EngineType::Qoder => None,
    }
}

pub(crate) fn claude_provider_models_from_env(
    provider_profile_id: &str,
    env: &std::collections::BTreeMap<String, String>,
) -> Vec<ModelInfo> {
    let overrides = ClaudeModelOverrides {
        main: normalize_non_empty(env.get("ANTHROPIC_MODEL").cloned()),
        fable: normalize_non_empty(env.get("ANTHROPIC_DEFAULT_FABLE_MODEL").cloned()),
        sonnet: normalize_non_empty(env.get("ANTHROPIC_DEFAULT_SONNET_MODEL").cloned()),
        opus: normalize_non_empty(env.get("ANTHROPIC_DEFAULT_OPUS_MODEL").cloned()),
        haiku: normalize_non_empty(env.get("ANTHROPIC_DEFAULT_HAIKU_MODEL").cloned()),
        reasoning: normalize_non_empty(env.get("ANTHROPIC_REASONING_MODEL").cloned()),
    };
    let mut models = get_builtin_claude_models();
    apply_claude_model_overrides(&mut models, overrides);
    ensure_default_model(&mut models);
    dedupe_models_preserve_order(models)
        .into_iter()
        .map(|model| model.with_provider_profile_id(provider_profile_id))
        .collect()
}

pub(crate) fn codex_provider_models_from_config(
    provider_profile_id: &str,
    config_toml: &str,
    custom_models: Vec<crate::types::CodexCustomModel>,
) -> Result<Vec<ModelInfo>, String> {
    let config: toml::Value = config_toml
        .parse()
        .map_err(|error| format!("invalid Codex provider configToml: {error}"))?;
    let configured_model = config
        .get("model")
        .and_then(toml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let configured_provider = config
        .get("model_provider")
        .and_then(toml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut models = custom_models
        .into_iter()
        .filter_map(|custom_model| {
            let id = custom_model.id.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let label = custom_model.label.trim();
            let mut model = ModelInfo::new(
                id.clone(),
                if label.is_empty() { id.as_str() } else { label },
            )
            .with_runtime_model(id)
            .with_source("provider-custom")
            .with_provenance("provider:codex-custom-model")
            .with_provider_profile_id(provider_profile_id);
            if let Some(description) = custom_model
                .description
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                model = model.with_description(description);
            }
            if let Some(provider) = configured_provider {
                model = model.with_provider(provider);
            }
            Some(model)
        })
        .collect::<Vec<_>>();
    if let Some(runtime_model) = configured_model {
        if let Some(existing) = models
            .iter_mut()
            .find(|model| model.model.trim() == runtime_model)
        {
            existing.default = true;
        } else {
            let mut model = ModelInfo::new(runtime_model, runtime_model)
                .with_runtime_model(runtime_model)
                .with_source("provider-config")
                .with_provenance("provider:codex-config-toml")
                .with_provider_profile_id(provider_profile_id)
                .as_default();
            if let Some(provider) = configured_provider {
                model = model.with_provider(provider);
            }
            models.insert(0, model);
        }
    }
    Ok(dedupe_models_preserve_order(models))
}

pub(crate) fn kimi_provider_models_from_config(
    provider_profile_id: &str,
    provider: crate::types::KimiProviderConfig,
) -> Vec<ModelInfo> {
    let runtime_model = provider.model.trim();
    if runtime_model.is_empty() {
        return Vec::new();
    }
    let display_name = provider
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(runtime_model);
    let provider_name = provider
        .provider_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("kimi");
    vec![ModelInfo::new(runtime_model, display_name)
        .with_runtime_model(runtime_model)
        .with_provider(provider_name)
        .with_protocol("kimi")
        .with_source("provider-config")
        .with_provenance("provider:kimi-config")
        .with_provider_profile_id(provider_profile_id)
        .as_default()]
}

pub(crate) fn grok_provider_models_from_config(
    provider_profile_id: &str,
    provider: crate::types::GrokProviderConfig,
) -> Vec<ModelInfo> {
    let runtime_model = provider.model.trim();
    if runtime_model.is_empty() {
        return Vec::new();
    }
    // Managed providers are materialized into the isolated GROK_HOME as
    // `[model."ccgui/<model>"]`. Grok's `-m` resolves config section aliases
    // (not inner `model` fields), so the catalog id must be the materialized
    // alias — passing the bare API model name would select the built-in model
    // and bypass the provider's base_url/api_key.
    let alias = format!(
        "{}{}",
        crate::engine::grok_provider_profile::GROK_MODEL_TOML_PREFIX,
        runtime_model
    );
    let display_name = provider
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(runtime_model);
    let provider_name = provider
        .provider_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("grok");
    vec![ModelInfo::new(alias, display_name)
        .with_provider(provider_name)
        .with_protocol("grok")
        .with_source("provider-config")
        .with_provenance("provider:grok-config")
        .with_provider_profile_id(provider_profile_id)
        .as_default()]
}

pub(crate) fn opencode_provider_models_from_config(
    provider_profile_id: &str,
    provider: &crate::types::OpenCodeProviderConfig,
) -> Vec<ModelInfo> {
    // Managed providers are injected via OPENCODE_CONFIG_CONTENT under the
    // stable `ccgui` provider key, so the catalog id must be the qualified
    // `ccgui/<model>` ref — passing the bare API model name would bypass the
    // provider's base_url/api_key.
    let provider_name = provider.name.trim();
    let provider_name = if provider_name.is_empty() {
        "opencode"
    } else {
        provider_name
    };
    let mut models = Vec::new();
    for raw_model in &provider.models {
        let runtime_model = raw_model.trim();
        if runtime_model.is_empty() {
            continue;
        }
        let qualified =
            crate::engine::opencode_provider_profile::qualify_managed_model_ref(runtime_model);
        models.push(
            ModelInfo::new(qualified.clone(), runtime_model)
                .with_runtime_model(qualified)
                .with_provider(provider_name)
                .with_protocol("opencode")
                .with_source("provider-config")
                .with_provenance("provider:opencode-config")
                .with_provider_profile_id(provider_profile_id),
        );
    }
    if let Some(first) = models.first_mut() {
        *first = first.clone().as_default();
    }
    models
}

/// 按引擎收尾 provider-scoped catalog：Codex 不拼 public generated fallback。
///
/// Codex generated fallback 描述的是官方 OpenAI 模型的可用性，属 provider relay
/// 的事实而非 binding 的事实：拼进三方 scope 会呈现幽灵可选模型（选中即 API
/// 报错，且假条目带满档 reasoning metadata，与真实三方条目形成误导对比）。
/// 空 catalog 由前端 configured-default / custom-model guidance 降级链路兜底
/// （fix-codex-third-party-provider-model-catalog）。Claude / Kimi / Grok 的
/// public 拼接行为保持不变。
pub(crate) fn finalize_provider_scoped_catalog(
    engine_type: EngineType,
    provider_models: Vec<ModelInfo>,
) -> Vec<ModelInfo> {
    if engine_type == EngineType::Codex {
        return provider_models;
    }
    merge_provider_models_with_public(provider_models, public_models_for_engine(engine_type))
}

pub(crate) fn get_provider_scoped_engine_models(
    engine_type: EngineType,
    provider_profile_id: Option<&str>,
) -> Result<Option<Vec<ModelInfo>>, String> {
    let Some(provider_profile_id) = provider_profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let provider_models = match engine_type {
        EngineType::Claude => {
            let Some(env) =
                crate::engine::claude::provider_profile::resolve_claude_provider_model_env(
                    provider_profile_id,
                )?
            else {
                return Ok(None);
            };
            claude_provider_models_from_env(provider_profile_id, &env)
        }
        EngineType::Codex => {
            let Some((config_toml, custom_models)) =
                crate::codex::provider_profile::resolve_codex_provider_model_config(
                    provider_profile_id,
                )?
            else {
                return Ok(None);
            };
            codex_provider_models_from_config(provider_profile_id, &config_toml, custom_models)?
        }
        EngineType::Kimi => {
            let Some(provider) =
                crate::engine::kimi_provider_profile::resolve_kimi_provider_model_config(
                    provider_profile_id,
                )?
            else {
                return Ok(None);
            };
            kimi_provider_models_from_config(provider_profile_id, provider)
        }
        EngineType::Grok => {
            let Some(provider) =
                crate::engine::grok_provider_profile::resolve_grok_provider_model_config(
                    provider_profile_id,
                )?
            else {
                return Ok(None);
            };
            grok_provider_models_from_config(provider_profile_id, provider)
        }
        EngineType::OpenCode => {
            let Some(provider) =
                crate::engine::opencode_provider_profile::resolve_opencode_provider_model_config(
                    provider_profile_id,
                )?
            else {
                return Ok(None);
            };
            // Unlike kimi/grok (materialized configs that keep built-in
            // providers working), an env-injected OPENCODE_CONFIG_CONTENT
            // disturbs the CLI's own provider auth resolution (observed: zen
            // 401 on 1.4.6 once a custom npm provider is declared). Managed
            // profiles therefore expose only their own models.
            return Ok(Some(opencode_provider_models_from_config(
                provider_profile_id,
                &provider,
            )));
        }
        EngineType::Gemini | EngineType::Pi | EngineType::Dsh | EngineType::Qoder => {
            return Ok(None)
        }
    };
    Ok(Some(finalize_provider_scoped_catalog(
        engine_type,
        provider_models,
    )))
}

/// 通用「CLI 默认模型置顶」约定（同 kimi / grok 既有内联实现语义）：
/// 清除全部 default 标记 → 命中 `default_id` 的条目标 default 并移到 index 0。
/// 未命中返回 `false` 且列表零变化——调用方维持 parse 层首条目兜底语义。
pub(crate) fn promote_default_model(models: &mut Vec<ModelInfo>, default_id: &str) -> bool {
    let Some(index) = models.iter().position(|model| model.id == default_id) else {
        return false;
    };
    for model in models.iter_mut() {
        model.default = false;
    }
    let mut matched = models.remove(index);
    matched.default = true;
    models.insert(0, matched);
    true
}

pub(crate) fn ensure_default_model(models: &mut [ModelInfo]) {
    if models.is_empty() {
        return;
    }
    if models.iter().any(|model| model.default) {
        return;
    }
    if let Some(first) = models.first_mut() {
        first.default = true;
    }
}

pub(crate) fn dedupe_models_preserve_order(models: Vec<ModelInfo>) -> Vec<ModelInfo> {
    let mut seen = std::collections::HashSet::new();
    let mut deduped = Vec::with_capacity(models.len());
    for model in models {
        // Prefer stable catalog id so family-mapped tiers (same runtime model)
        // remain distinct rows in the picker.
        let identity = if model.id.trim().is_empty() {
            if model.model.trim().is_empty() {
                continue;
            }
            model.model.clone()
        } else {
            model.id.clone()
        };
        if seen.insert(identity) {
            deduped.push(model);
        }
    }
    deduped
}
