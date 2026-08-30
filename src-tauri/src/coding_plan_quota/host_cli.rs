//! DSH / PI host-CLI credential resolve for coding-plan HTTP quota.
//!
//! Read-only: never writes `$DSH_HOME` or `~/.pi/agent`. The returned
//! `(base_url, api_key)` pair is fed into the existing
//! `resolve_quota_route` → `query_by_base_url_and_key` path.
//!
//! DSH 0.1.1+ stores keys under `.credentials.yaml` `refs:`; pre-release
//! files were a flat `ENV: value` mapping. Both layouts are read.

use serde_json::Value;
use std::path::{Path, PathBuf};

use crate::engine::dsh::session::is_reserved_mossx_dsh_provider;
use crate::engine::dsh_provider_profile::DSH_LOCAL_PROVIDER_PROFILE_ID;
use crate::engine::pi_provider_profile::PI_LOCAL_PROVIDER_PROFILE_ID;

const DSH_OFFICIAL_DEEPSEEK_VENDOR: &str = "deepseek-official";
const DSH_OFFICIAL_DEEPSEEK_NS: &str = "llm-deepseek";
const DSH_OFFICIAL_DEEPSEEK_KEY_ENV: &str = "DEEPSEEK_API_KEY";
const DSH_OFFICIAL_DEEPSEEK_BASE_ENV: &str = "DEEPSEEK_BASE_URL";
const DSH_OFFICIAL_DEEPSEEK_BASE: &str = "https://api.deepseek.com";
const DSH_CUSTOM_NS: &str = "llm-pi-ai";

pub(crate) fn host_cli_vendor_id(provider_profile_id: Option<&str>) -> Option<String> {
    let raw = provider_profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    if is_host_catalog_sentinel(raw) {
        return None;
    }
    let first = raw
        .split('/')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    if is_host_catalog_sentinel(first) {
        return None;
    }
    Some(first.to_string())
}

fn is_host_catalog_sentinel(value: &str) -> bool {
    let trimmed = value.trim();
    (trimmed.starts_with("__") && trimmed.ends_with("__") && trimmed.len() > 4)
        || trimmed == DSH_LOCAL_PROVIDER_PROFILE_ID
        || trimmed == PI_LOCAL_PROVIDER_PROFILE_ID
}

fn official_known_base_url(vendor: &str) -> Option<&'static str> {
    match vendor.trim().to_ascii_lowercase().as_str() {
        "deepseek" | "deepseek-official" => Some("https://api.deepseek.com"),
        "kimi-coding" => Some("https://api.kimi.com/coding"),
        "minimax" | "minimax-cn" => Some("https://api.minimaxi.com"),
        "zai" | "zai-coding-cn" => Some("https://open.bigmodel.cn/api/coding/paas/v4"),
        "anthropic" => Some("https://api.anthropic.com"),
        "openai" => Some("https://api.openai.com/v1"),
        "xai" | "grok" => Some("https://api.x.ai"),
        _ => None,
    }
}

fn official_default_api_key_env(vendor: &str) -> Option<&'static str> {
    match vendor.trim().to_ascii_lowercase().as_str() {
        "deepseek" | "deepseek-official" => Some(DSH_OFFICIAL_DEEPSEEK_KEY_ENV),
        "kimi-coding" => Some("KIMI_CODING_API_KEY"),
        "minimax" => Some("MINIMAX_API_KEY"),
        "minimax-cn" => Some("MINIMAX_CN_API_KEY"),
        "zai" => Some("ZAI_API_KEY"),
        "zai-coding-cn" => Some("ZAI_CODING_CN_API_KEY"),
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "openai" => Some("OPENAI_API_KEY"),
        "xai" | "grok" => Some("XAI_API_KEY"),
        _ => None,
    }
}

fn derived_vendor_api_key_env(vendor: &str) -> String {
    let slug = vendor
        .trim()
        .to_ascii_uppercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    let slug = slug.trim_matches('_');
    if slug.is_empty() {
        "API_KEY".to_string()
    } else {
        format!("{slug}_API_KEY")
    }
}

fn resolve_vendor_api_key_env(vendor: &str, profile: Option<&serde_yaml::Mapping>) -> String {
    if let Some(env_name) = profile.and_then(|map| yaml_str(map, "apiKeyEnv")) {
        return env_name;
    }
    if let Some(env_name) = official_default_api_key_env(vendor) {
        return env_name.to_string();
    }
    crate::engine::pi_auth::pi_catalog_env_var(vendor)
        .map(str::to_string)
        .unwrap_or_else(|| derived_vendor_api_key_env(vendor))
}

fn env_lookup(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn yaml_mapping(path: &Path) -> Option<serde_yaml::Mapping> {
    let content = std::fs::read_to_string(path).ok()?;
    if content.trim().is_empty() {
        return None;
    }
    serde_yaml::from_str::<serde_yaml::Value>(&content)
        .ok()
        .and_then(|value| value.as_mapping().cloned())
}

fn yaml_key(key: &str) -> serde_yaml::Value {
    serde_yaml::Value::String(key.to_string())
}

fn yaml_str(map: &serde_yaml::Mapping, key: &str) -> Option<String> {
    map.get(&yaml_key(key))
        .and_then(serde_yaml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn yaml_child<'a>(map: &'a serde_yaml::Mapping, key: &str) -> Option<&'a serde_yaml::Mapping> {
    map.get(&yaml_key(key))
        .and_then(serde_yaml::Value::as_mapping)
}

fn lookup_credential_value(
    credentials: Option<&serde_yaml::Mapping>,
    env_name: &str,
) -> Option<String> {
    let map = credentials?;
    // DSH 0.1.1+ versioned document nests env keys under `refs`.
    yaml_child(map, "refs")
        .and_then(|refs| yaml_str(refs, env_name))
        .or_else(|| yaml_str(map, env_name))
}

fn lookup_env_or_credentials(
    env_name: &str,
    env_lookup: &dyn Fn(&str) -> Option<String>,
    credentials: Option<&serde_yaml::Mapping>,
) -> String {
    if let Some(value) = env_lookup(env_name) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    lookup_credential_value(credentials, env_name).unwrap_or_default()
}

pub(crate) fn resolve_dsh_base_url_and_key(
    provider_profile_id: Option<&str>,
) -> Result<(String, String), String> {
    let home = crate::engine::dsh::dsh_home_dir()
        .ok_or_else(|| "dsh credentials missing (cannot resolve DSH_HOME)".to_string())?;
    resolve_dsh_base_url_and_key_from_home(&home, provider_profile_id, &env_lookup)
}

pub(crate) fn resolve_dsh_base_url_and_key_from_home(
    home: &Path,
    provider_profile_id: Option<&str>,
    env_lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<(String, String), String> {
    let vendor = host_cli_vendor_id(provider_profile_id)
        .ok_or_else(|| "dsh coding-plan vendor missing".to_string())?;
    if is_reserved_mossx_dsh_provider(&vendor) {
        return Err("dsh coding-plan vendor missing".to_string());
    }

    let settings = yaml_mapping(&home.join("settings.yaml"));
    let credentials = yaml_mapping(&home.join(".credentials.yaml"));

    if vendor.eq_ignore_ascii_case(DSH_OFFICIAL_DEEPSEEK_VENDOR) {
        let namespace = settings
            .as_ref()
            .and_then(|root| yaml_child(root, DSH_OFFICIAL_DEEPSEEK_NS));
        let base_url = env_lookup(DSH_OFFICIAL_DEEPSEEK_BASE_ENV)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| namespace.and_then(|map| yaml_str(map, "baseURL")))
            .unwrap_or_else(|| DSH_OFFICIAL_DEEPSEEK_BASE.to_string());
        let key_env = namespace
            .and_then(|map| yaml_str(map, "apiKeyEnv"))
            .unwrap_or_else(|| DSH_OFFICIAL_DEEPSEEK_KEY_ENV.to_string());
        let api_key = lookup_env_or_credentials(&key_env, env_lookup, credentials.as_ref());
        return Ok((base_url, api_key));
    }

    // Official DSH routes (`kimi-coding`, `minimax-cn`, later `openai`, …) live
    // under `llm-pi-ai.providers` with `apiKeyEnv` and no `baseURL`. Custom
    // vendors keep their own `baseURL`. Never invent an unknown host, and never
    // fall back to `agent-default-model`.
    let profile = settings
        .as_ref()
        .and_then(|root| yaml_child(root, DSH_CUSTOM_NS))
        .and_then(|namespace| yaml_child(namespace, "providers"))
        .and_then(|providers| providers.get(&yaml_key(&vendor)))
        .and_then(serde_yaml::Value::as_mapping);
    let base_url = profile
        .and_then(|map| yaml_str(map, "baseURL"))
        .or_else(|| official_known_base_url(&vendor).map(str::to_string))
        .unwrap_or_default();
    if base_url.is_empty() {
        return Err(format!(
            "dsh coding-plan vendor {vendor} credentials missing"
        ));
    }
    let key_env = resolve_vendor_api_key_env(&vendor, profile);
    let api_key = lookup_env_or_credentials(&key_env, env_lookup, credentials.as_ref());
    Ok((base_url, api_key))
}

fn pi_agent_dir() -> Option<PathBuf> {
    if let Ok(agent_dir) = std::env::var("PI_CODING_AGENT_DIR") {
        let trimmed = agent_dir.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    dirs::home_dir().map(|home| home.join(".pi").join("agent"))
}

pub(crate) fn resolve_pi_base_url_and_key(
    provider_profile_id: Option<&str>,
) -> Result<(String, String), String> {
    let home = pi_agent_dir()
        .ok_or_else(|| "pi credentials missing (cannot resolve PI agent dir)".to_string())?;
    resolve_pi_base_url_and_key_from_home(&home, provider_profile_id, &env_lookup)
}

pub(crate) fn resolve_pi_base_url_and_key_from_home(
    agent_dir: &Path,
    provider_profile_id: Option<&str>,
    env_lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<(String, String), String> {
    let vendor = host_cli_vendor_id(provider_profile_id)
        .ok_or_else(|| "pi coding-plan vendor missing".to_string())?;

    let base_url = read_pi_models_store_base_url(agent_dir, &vendor)
        .or_else(|| official_known_base_url(&vendor).map(str::to_string))
        .unwrap_or_default();
    if base_url.is_empty() {
        return Err(format!(
            "pi coding-plan vendor {vendor} credentials missing"
        ));
    }

    let api_key = read_pi_api_key(agent_dir, &vendor, env_lookup)?;
    Ok((base_url, api_key))
}

fn read_pi_models_store_base_url(agent_dir: &Path, vendor: &str) -> Option<String> {
    let content = std::fs::read_to_string(agent_dir.join("models-store.json")).ok()?;
    if content.trim().is_empty() {
        return None;
    }
    let root: Value = serde_json::from_str(&content).ok()?;
    let models = root.get(vendor)?.get("models")?.as_array()?;
    for model in models {
        if let Some(url) = model
            .get("baseUrl")
            .or_else(|| model.get("base_url"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(url.to_string());
        }
    }
    None
}

pub(crate) fn read_pi_openai_codex_auth() -> Result<(String, String), String> {
    let agent_dir =
        pi_agent_dir().ok_or_else(|| "pi credentials directory unavailable".to_string())?;
    let auth_path = agent_dir.join("auth.json");
    let content = std::fs::read_to_string(&auth_path)
        .map_err(|_| "pi OpenAI login missing; run `pi /login openai`".to_string())?;
    let root: Value = serde_json::from_str(&content)
        .map_err(|error| format!("pi credentials missing (auth.json invalid): {error}"))?;
    for provider in ["openai-codex", "openai"] {
        let Some(entry) = root.get(provider) else {
            continue;
        };
        if entry.get("type").and_then(Value::as_str) != Some("oauth") {
            continue;
        }
        let Some(access) = entry.get("access").and_then(Value::as_str).map(str::trim) else {
            continue;
        };
        let Some(account_id) = entry
            .get("accountId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if !access.is_empty() {
            return Ok((access.to_string(), account_id.to_string()));
        }
    }
    Err("pi OpenAI login missing; run `pi /login openai`".to_string())
}

fn read_pi_api_key(
    agent_dir: &Path,
    vendor: &str,
    env_lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<String, String> {
    let auth_path = agent_dir.join("auth.json");
    match std::fs::read_to_string(&auth_path) {
        Ok(content) if !content.trim().is_empty() => {
            let root: Value = serde_json::from_str(&content)
                .map_err(|error| format!("pi credentials missing (auth.json invalid): {error}"))?;
            if let Some(entry) = root.get(vendor) {
                let entry_type = entry
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("api_key");
                if entry_type == "api_key" {
                    if let Some(key) = entry.get("key").and_then(Value::as_str).map(str::trim) {
                        if key.starts_with('!') {
                            // Never execute PI `!command` keys for quota.
                            return Ok(String::new());
                        }
                        if !key.is_empty() {
                            if let Some(env_name) = key.strip_prefix('$') {
                                let env_name = env_name.trim();
                                return Ok(if env_name.is_empty() {
                                    String::new()
                                } else {
                                    env_lookup(env_name).unwrap_or_default()
                                });
                            }
                            return Ok(key.to_string());
                        }
                    }
                }
            }
        }
        Ok(_) | Err(_) => {}
    }

    Ok(crate::engine::pi_auth::pi_catalog_env_var(vendor)
        .and_then(env_lookup)
        .unwrap_or_default())
}
