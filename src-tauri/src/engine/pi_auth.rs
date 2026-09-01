//! PI CLI provider auth: read/write `~/.pi/agent/auth.json`.
//!
//! Contract (openspec/changes/add-pi-provider-auth):
//! - auth.json is the single source of truth; unknown entries, `type == "oauth"`
//!   entries and credential `env` sub-objects MUST survive writes untouched.
//! - Writes are atomic (same-dir tmp + rename) with `0600` permissions on Unix.
//! - A corrupted auth.json fails closed: errors are returned, the file is never
//!   overwritten.
//! - Full API keys never leave this module: list output only carries a masked
//!   display string (head(6) + tail(4); short keys fully masked; `!` command /
//!   `$` env-interpolation keys are returned verbatim since they are not secrets).

use serde::Serialize;
use serde_json::{Map, Value};
use std::path::PathBuf;
use tauri::{AppHandle, State};

use crate::remote_backend;
use crate::state::AppState;

use super::EngineType;

/// Provider catalog aligned with pi v0.84.3 env map（bundle 内 `envVar` 对象 +
/// anthropic 特例分支）。2026-08-27 对齐审计：0.84.1 → 0.84.3 provider/env-key
/// 零漂移（providers.md 与 env help 逐项 diff），本次补录两版都存在但
/// providers.md 未收录、此前按文档对齐时漏掉的 `moonshotai` / `moonshotai-cn`
/// （MOONSHOT_API_KEY）。`google-vertex` 走 ADC/service account（非贴 key 型），
/// 不进本目录。`env_var: None` marks OAuth-only providers (GitHub Copilot).
struct PiAuthProviderDef {
    id: &'static str,
    env_var: Option<&'static str>,
}

const PI_AUTH_PROVIDER_CATALOG: &[PiAuthProviderDef] = &[
    PiAuthProviderDef {
        id: "anthropic",
        env_var: Some("ANTHROPIC_API_KEY"),
    },
    PiAuthProviderDef {
        id: "ant-ling",
        env_var: Some("ANT_LING_API_KEY"),
    },
    PiAuthProviderDef {
        id: "azure-openai-responses",
        env_var: Some("AZURE_OPENAI_API_KEY"),
    },
    PiAuthProviderDef {
        id: "openai",
        env_var: Some("OPENAI_API_KEY"),
    },
    PiAuthProviderDef {
        id: "deepseek",
        env_var: Some("DEEPSEEK_API_KEY"),
    },
    PiAuthProviderDef {
        id: "nvidia",
        env_var: Some("NVIDIA_API_KEY"),
    },
    PiAuthProviderDef {
        id: "google",
        env_var: Some("GEMINI_API_KEY"),
    },
    PiAuthProviderDef {
        id: "amazon-bedrock",
        env_var: Some("AWS_BEARER_TOKEN_BEDROCK"),
    },
    PiAuthProviderDef {
        id: "mistral",
        env_var: Some("MISTRAL_API_KEY"),
    },
    PiAuthProviderDef {
        id: "groq",
        env_var: Some("GROQ_API_KEY"),
    },
    PiAuthProviderDef {
        id: "cerebras",
        env_var: Some("CEREBRAS_API_KEY"),
    },
    PiAuthProviderDef {
        id: "cloudflare-ai-gateway",
        env_var: Some("CLOUDFLARE_API_KEY"),
    },
    PiAuthProviderDef {
        id: "cloudflare-workers-ai",
        env_var: Some("CLOUDFLARE_API_KEY"),
    },
    PiAuthProviderDef {
        id: "xai",
        env_var: Some("XAI_API_KEY"),
    },
    PiAuthProviderDef {
        id: "openrouter",
        env_var: Some("OPENROUTER_API_KEY"),
    },
    PiAuthProviderDef {
        id: "vercel-ai-gateway",
        env_var: Some("AI_GATEWAY_API_KEY"),
    },
    PiAuthProviderDef {
        id: "zai",
        env_var: Some("ZAI_API_KEY"),
    },
    PiAuthProviderDef {
        id: "zai-coding-cn",
        env_var: Some("ZAI_CODING_CN_API_KEY"),
    },
    PiAuthProviderDef {
        id: "opencode",
        env_var: Some("OPENCODE_API_KEY"),
    },
    PiAuthProviderDef {
        id: "opencode-go",
        env_var: Some("OPENCODE_API_KEY"),
    },
    PiAuthProviderDef {
        id: "radius",
        env_var: Some("RADIUS_API_KEY"),
    },
    PiAuthProviderDef {
        id: "huggingface",
        env_var: Some("HF_TOKEN"),
    },
    PiAuthProviderDef {
        id: "fireworks",
        env_var: Some("FIREWORKS_API_KEY"),
    },
    PiAuthProviderDef {
        id: "together",
        env_var: Some("TOGETHER_API_KEY"),
    },
    PiAuthProviderDef {
        id: "baseten",
        env_var: Some("BASETEN_API_KEY"),
    },
    PiAuthProviderDef {
        id: "kimi-coding",
        env_var: Some("KIMI_API_KEY"),
    },
    PiAuthProviderDef {
        id: "moonshotai",
        env_var: Some("MOONSHOT_API_KEY"),
    },
    PiAuthProviderDef {
        id: "moonshotai-cn",
        env_var: Some("MOONSHOT_API_KEY"),
    },
    PiAuthProviderDef {
        id: "minimax",
        env_var: Some("MINIMAX_API_KEY"),
    },
    PiAuthProviderDef {
        id: "minimax-cn",
        env_var: Some("MINIMAX_CN_API_KEY"),
    },
    PiAuthProviderDef {
        id: "qwen-token-plan",
        env_var: Some("QWEN_TOKEN_PLAN_API_KEY"),
    },
    PiAuthProviderDef {
        id: "qwen-token-plan-individual",
        env_var: Some("QWEN_TOKEN_PLAN_API_KEY"),
    },
    PiAuthProviderDef {
        id: "qwen-token-plan-cn",
        env_var: Some("QWEN_TOKEN_PLAN_CN_API_KEY"),
    },
    PiAuthProviderDef {
        id: "xiaomi",
        env_var: Some("XIAOMI_API_KEY"),
    },
    PiAuthProviderDef {
        id: "xiaomi-token-plan-cn",
        env_var: Some("XIAOMI_TOKEN_PLAN_CN_API_KEY"),
    },
    PiAuthProviderDef {
        id: "xiaomi-token-plan-ams",
        env_var: Some("XIAOMI_TOKEN_PLAN_AMS_API_KEY"),
    },
    PiAuthProviderDef {
        id: "xiaomi-token-plan-sgp",
        env_var: Some("XIAOMI_TOKEN_PLAN_SGP_API_KEY"),
    },
    // OAuth-only (no env var / api_key path in pi).
    PiAuthProviderDef {
        id: "github-copilot",
        env_var: None,
    },
];

fn catalog_entry(provider_id: &str) -> Option<&'static PiAuthProviderDef> {
    PI_AUTH_PROVIDER_CATALOG
        .iter()
        .find(|item| item.id == provider_id)
}

/// pi 订阅型 OAuth 的 auth.json key 与 API-key provider id 不同名的唯一分叉点：
/// `/login openai` 走 ChatGPT 订阅流，pi 0.84.x 以订阅 provider id
/// `openai-codex`（createProvider id，见 pi bundle）落盘 auth.json；
/// `openai` 仅承载 OPENAI_API_KEY。对齐审计 2026-08-28（pi 0.84.3 本体）。
const OAUTH_ENTRY_ID_ALIASES: &[(&str, &str)] = &[("openai", "openai-codex")];

/// 订阅判定要看的 auth.json key 集合：本 id + 可能的 OAuth 别名 id。
fn oauth_entry_ids(provider_id: &str) -> impl Iterator<Item = &str> {
    let alias = OAUTH_ENTRY_ID_ALIASES
        .iter()
        .find(|(id, _)| *id == provider_id)
        .map(|(_, alias)| *alias);
    [Some(provider_id), alias].into_iter().flatten()
}

pub(crate) fn pi_catalog_env_var(provider_id: &str) -> Option<&'static str> {
    catalog_entry(provider_id).and_then(|item| item.env_var)
}

/// Resolve `<agent>/auth.json`, mirroring `pi_history::resolve_pi_family_sessions_root`:
/// engine-config home override → `PI_CODING_AGENT_DIR` → `~/.pi/agent`.
pub fn resolve_pi_auth_file(home_override: Option<&str>) -> PathBuf {
    if let Some(home) = home_override.map(str::trim).filter(|v| !v.is_empty()) {
        return PathBuf::from(home).join("auth.json");
    }
    if let Ok(agent_dir) = std::env::var("PI_CODING_AGENT_DIR") {
        let trimmed = agent_dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("auth.json");
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".pi")
        .join("agent")
        .join("auth.json")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAuthProviderSnapshot {
    pub id: String,
    pub env_var: Option<String>,
    /// configured | none
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub masked_key: Option<String>,
    /// literal | command | envRef — how pi will resolve the stored key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_source: Option<String>,
    /// true when an OAuth (`type == "oauth"`) credential exists for this id.
    pub oauth_subscribed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAuthListResult {
    pub auth_file: PiAuthFileInfo,
    pub providers: Vec<PiAuthProviderSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAuthFileInfo {
    pub path: String,
    pub exists: bool,
}

/// Mask a stored key for display. Never exposes more than head(6) + tail(4).
fn mask_key(key: &str) -> String {
    if key.starts_with('!') || key.starts_with('$') {
        // Command execution / env interpolation: not a secret literal.
        return key.to_string();
    }
    if key.chars().count() > 10 {
        let head: String = key.chars().take(6).collect();
        let tail: String = key
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("{head}········{tail}")
    } else {
        "········".to_string()
    }
}

fn key_source(key: &str) -> &'static str {
    if key.starts_with('!') {
        "command"
    } else if key.starts_with('$') {
        "envRef"
    } else {
        "literal"
    }
}

/// Read auth.json into a JSON object map.
/// - Missing file → `Ok(None)`.
/// - Corrupted JSON / non-object root → `Err` (fail-closed; never overwritten).
async fn read_auth_map(path: &PathBuf) -> Result<Option<Map<String, Value>>, String> {
    match tokio::fs::read_to_string(path).await {
        Ok(content) => {
            let value: Value = serde_json::from_str(&content).map_err(|error| {
                format!("[PI_AUTH_CORRUPTED] ~/.pi/agent/auth.json 不是合法 JSON：{error}")
            })?;
            match value {
                Value::Object(map) => Ok(Some(map)),
                _ => Err(
                    "[PI_AUTH_CORRUPTED] ~/.pi/agent/auth.json 根节点必须是 JSON 对象".to_string(),
                ),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("[PI_AUTH_READ] 读取 auth.json 失败：{error}")),
    }
}

/// Atomically write the auth map: same-dir tmp file + rename, `0600` on Unix.
async fn write_auth_map(path: &PathBuf, map: &Map<String, Value>) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "[PI_AUTH_WRITE] auth.json 路径无父目录".to_string())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| format!("[PI_AUTH_WRITE] 创建 {} 失败：{error}", parent.display()))?;

    let tmp = parent.join(format!(".auth.json.tmp-{}", std::process::id()));
    let content = serde_json::to_string_pretty(&Value::Object(map.clone()))
        .map_err(|error| format!("[PI_AUTH_WRITE] 序列化失败：{error}"))?;

    let write_result = async {
        tokio::fs::write(&tmp, format!("{content}\n"))
            .await
            .map_err(|error| format!("[PI_AUTH_WRITE] 写入临时文件失败：{error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))
                .await
                .map_err(|error| format!("[PI_AUTH_WRITE] 设置 0600 权限失败：{error}"))?;
        }
        tokio::fs::rename(&tmp, path)
            .await
            .map_err(|error| format!("[PI_AUTH_WRITE] 原子替换 auth.json 失败：{error}"))?;
        Ok::<(), String>(())
    }
    .await;

    if write_result.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    write_result
}

pub async fn list_pi_auth_providers(
    home_override: Option<&str>,
) -> Result<PiAuthListResult, String> {
    let path = resolve_pi_auth_file(home_override);
    let map = read_auth_map(&path).await?;
    let exists = map.is_some();
    let map = map.unwrap_or_default();

    let providers = PI_AUTH_PROVIDER_CATALOG
        .iter()
        .map(|def| {
            let entry = map.get(def.id);
            let oauth_subscribed = oauth_entry_ids(def.id).any(|key| {
                map.get(key)
                    .and_then(|item| item.get("type"))
                    .and_then(Value::as_str)
                    == Some("oauth")
            });
            let api_key = entry
                .filter(|item| item.get("type").and_then(Value::as_str) == Some("api_key"))
                .and_then(|item| item.get("key"))
                .and_then(Value::as_str);

            // pi resolution order: --api-key → auth.json → 环境变量 → models.json。
            // 本区块只管 auth.json：应用进程 env ≠ pi 终端（登录 shell）实际继承的
            // env，按进程 env 报「env 生效中」不可靠，还会把行锁死在「覆盖设置」态
            // （无编辑/删除路径），2026-08-28 摘除——未落 auth.json 一律视为未配置。
            let (state, masked_key, src) = if let Some(key) = api_key {
                (
                    "configured".to_string(),
                    Some(mask_key(key)),
                    Some(key_source(key).to_string()),
                )
            } else {
                ("none".to_string(), None, None)
            };

            PiAuthProviderSnapshot {
                id: def.id.to_string(),
                env_var: def.env_var.map(str::to_string),
                state,
                masked_key,
                key_source: src,
                oauth_subscribed,
            }
        })
        .collect();

    Ok(PiAuthListResult {
        auth_file: PiAuthFileInfo {
            path: path.to_string_lossy().to_string(),
            exists,
        },
        providers,
    })
}

pub async fn set_pi_auth_api_key(
    provider_id: &str,
    key: &str,
    home_override: Option<&str>,
) -> Result<(), String> {
    let def = catalog_entry(provider_id)
        .ok_or_else(|| format!("[PI_AUTH_UNKNOWN_PROVIDER] 未知 PI provider：{provider_id}"))?;
    if def.env_var.is_none() {
        return Err(format!(
            "[PI_AUTH_OAUTH_ONLY] {provider_id} 仅支持 OAuth 订阅授权，请在终端运行 pi /login"
        ));
    }
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("[PI_AUTH_EMPTY_KEY] API Key 不能为空".to_string());
    }
    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err("[PI_AUTH_INVALID_KEY] API Key 不能包含换行".to_string());
    }

    let path = resolve_pi_auth_file(home_override);
    let mut map = read_auth_map(&path).await?.unwrap_or_default();
    let mut credential = Map::new();
    credential.insert("type".to_string(), Value::String("api_key".to_string()));
    credential.insert("key".to_string(), Value::String(trimmed.to_string()));
    map.insert(def.id.to_string(), Value::Object(credential));
    write_auth_map(&path, &map).await
}

pub async fn delete_pi_auth_credential(
    provider_id: &str,
    home_override: Option<&str>,
) -> Result<(), String> {
    let def = catalog_entry(provider_id)
        .ok_or_else(|| format!("[PI_AUTH_UNKNOWN_PROVIDER] 未知 PI provider：{provider_id}"))?;
    let path = resolve_pi_auth_file(home_override);
    let mut map = match read_auth_map(&path).await? {
        Some(map) => map,
        None => return Ok(()), // nothing to delete
    };
    if let Some(entry) = map.get(def.id) {
        let entry_type = entry.get("type").and_then(Value::as_str).unwrap_or("");
        if entry_type == "oauth" {
            return Err(format!(
                "[PI_AUTH_OAUTH_MANAGED] {provider_id} 为 OAuth 订阅凭证，由 pi 自管；请在终端运行 pi /logout"
            ));
        }
    }
    map.remove(def.id);
    write_auth_map(&path, &map).await
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// List PI provider catalog with credential states (keys masked).
#[tauri::command]
pub async fn pi_auth_list_providers(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&state).await {
        return remote_backend::call_remote(
            &state,
            app,
            "pi_auth_list_providers",
            serde_json::json!({}),
        )
        .await;
    }
    let config = state.engine_manager.get_engine_config(EngineType::Pi).await;
    let result =
        list_pi_auth_providers(config.as_ref().and_then(|item| item.home_dir.as_deref())).await?;
    serde_json::to_value(result).map_err(|error| error.to_string())
}

/// Set (create/replace) an API key credential in auth.json.
#[tauri::command]
pub async fn pi_auth_set_api_key(
    provider_id: String,
    key: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&state).await {
        return remote_backend::call_remote(
            &state,
            app,
            "pi_auth_set_api_key",
            serde_json::json!({ "providerId": provider_id, "key": key }),
        )
        .await
        .map(|_| ());
    }
    let config = state.engine_manager.get_engine_config(EngineType::Pi).await;
    set_pi_auth_api_key(
        &provider_id,
        &key,
        config.as_ref().and_then(|item| item.home_dir.as_deref()),
    )
    .await?;
    // 凭证写入改变 pi 的可用模型目录（pi 每次实时按 auth.json 过滤），
    // 必须清掉内存态目录缓存，否则模型选择器继续展示已变更 provider 的模型。
    // 只清 models 保留状态条目：detect TTL 命中路径透出全量 statuses，
    // 缺条目会让引擎菜单在窗口期漏掉 PI。
    state
        .engine_manager
        .invalidate_engine_models(EngineType::Pi)
        .await;
    Ok(())
}

/// Delete an api_key credential from auth.json (OAuth entries are refused).
#[tauri::command]
pub async fn pi_auth_delete_credential(
    provider_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&state).await {
        return remote_backend::call_remote(
            &state,
            app,
            "pi_auth_delete_credential",
            serde_json::json!({ "providerId": provider_id }),
        )
        .await
        .map(|_| ());
    }
    let config = state.engine_manager.get_engine_config(EngineType::Pi).await;
    delete_pi_auth_credential(
        &provider_id,
        config.as_ref().and_then(|item| item.home_dir.as_deref()),
    )
    .await?;
    // 同 set：删除后目录按实时探测收敛，防 picker 继续展示已删 provider 的模型。
    state
        .engine_manager
        .invalidate_engine_models(EngineType::Pi)
        .await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_agent_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mossx-pi-auth-test-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn mask_long_key_exposes_only_head_and_tail() {
        assert_eq!(mask_key("sk-ant-abcdef1234567890xyz"), "sk-ant········0xyz");
    }

    #[test]
    fn mask_short_key_exposes_nothing() {
        assert_eq!(mask_key("short"), "········");
        assert_eq!(mask_key("1234567890"), "········");
    }

    #[test]
    fn mask_command_and_env_keys_verbatim() {
        assert_eq!(
            mask_key("!op read 'op://vault/item'"),
            "!op read 'op://vault/item'"
        );
        assert_eq!(mask_key("$MY_API_KEY"), "$MY_API_KEY");
        assert_eq!(key_source("!cmd"), "command");
        assert_eq!(key_source("${A}_${B}"), "envRef");
        assert_eq!(key_source("sk-1"), "literal");
    }

    #[tokio::test]
    async fn list_missing_file_is_all_none() {
        let dir = temp_agent_dir("missing");
        let agent = dir.to_string_lossy().to_string();
        let result = list_pi_auth_providers(Some(&agent)).await.unwrap();
        assert!(!result.auth_file.exists);
        assert!(result.providers.len() >= 37);
        assert!(result.providers.iter().all(|item| item.state == "none"));
    }

    #[tokio::test]
    async fn corrupted_file_fails_closed() {
        let dir = temp_agent_dir("corrupted");
        let agent = dir.to_string_lossy().to_string();
        let auth = dir.join("auth.json");
        std::fs::write(&auth, "{ not json").unwrap();
        assert!(list_pi_auth_providers(Some(&agent)).await.is_err());
        assert!(set_pi_auth_api_key("openai", "sk-x", Some(&agent))
            .await
            .is_err());
        // File untouched byte-for-byte.
        assert_eq!(std::fs::read_to_string(&auth).unwrap(), "{ not json");
    }

    #[tokio::test]
    async fn set_and_list_roundtrip_preserves_unknown_entries() {
        let dir = temp_agent_dir("roundtrip");
        let agent = dir.to_string_lossy().to_string();
        let auth = dir.join("auth.json");
        std::fs::write(
            &auth,
            r#"{"custom-thing":{"type":"api_key","key":"keep-me"},"anthropic":{"type":"oauth","access":"tok"}}"#,
        )
        .unwrap();

        set_pi_auth_api_key("openai", "sk-proj-1234567890abcd", Some(&agent))
            .await
            .unwrap();

        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&auth).unwrap()).unwrap();
        assert_eq!(written["custom-thing"]["key"], "keep-me");
        assert_eq!(written["anthropic"]["type"], "oauth");
        assert_eq!(written["openai"]["type"], "api_key");
        assert_eq!(written["openai"]["key"], "sk-proj-1234567890abcd");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&auth).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }

        let list = list_pi_auth_providers(Some(&agent)).await.unwrap();
        let openai = list
            .providers
            .iter()
            .find(|item| item.id == "openai")
            .unwrap();
        assert_eq!(openai.state, "configured");
        assert_eq!(openai.masked_key.as_deref(), Some("sk-pro········abcd"));
        let anthropic = list
            .providers
            .iter()
            .find(|item| item.id == "anthropic")
            .unwrap();
        assert!(anthropic.oauth_subscribed);
        assert_eq!(anthropic.state, "none"); // oauth entry is not an api_key state
    }

    #[tokio::test]
    async fn oauth_alias_marks_openai_subscribed_via_openai_codex_entry() {
        // pi 0.84.x `/login openai`（ChatGPT 订阅）以 provider id `openai-codex`
        // 落盘 auth.json；UI 的 `openai` 行（ChatGPT Plus / Pro）必须读出已订阅。
        let dir = temp_agent_dir("oauth-alias");
        let agent = dir.to_string_lossy().to_string();
        std::fs::write(
            dir.join("auth.json"),
            r#"{"openai-codex":{"type":"oauth","access":"tok","refresh":"r","expires":9999999999}}"#,
        )
        .unwrap();

        let list = list_pi_auth_providers(Some(&agent)).await.unwrap();
        let openai = list
            .providers
            .iter()
            .find(|item| item.id == "openai")
            .unwrap();
        assert!(openai.oauth_subscribed);
        // 无 OPENAI_API_KEY：api_key 状态仍是 none，订阅与 API Key 两组互不污染。
        assert_eq!(openai.state, "none");
    }

    #[tokio::test]
    async fn delete_api_key_entry_and_reject_oauth() {
        let dir = temp_agent_dir("delete");
        let agent = dir.to_string_lossy().to_string();
        set_pi_auth_api_key("deepseek", "sk-ds-1234567890wxyz", Some(&agent))
            .await
            .unwrap();
        delete_pi_auth_credential("deepseek", Some(&agent))
            .await
            .unwrap();
        let list = list_pi_auth_providers(Some(&agent)).await.unwrap();
        let ds = list
            .providers
            .iter()
            .find(|item| item.id == "deepseek")
            .unwrap();
        assert_eq!(ds.state, "none");

        let auth = dir.join("auth.json");
        std::fs::write(&auth, r#"{"openai":{"type":"oauth","access":"tok"}}"#).unwrap();
        let error = delete_pi_auth_credential("openai", Some(&agent))
            .await
            .unwrap_err();
        assert!(error.contains("PI_AUTH_OAUTH_MANAGED"));
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&auth).unwrap()).unwrap();
        assert_eq!(written["openai"]["type"], "oauth");
    }

    #[tokio::test]
    async fn rejects_unknown_provider_empty_and_multiline_key() {
        let dir = temp_agent_dir("validate");
        let agent = dir.to_string_lossy().to_string();
        assert!(set_pi_auth_api_key("not-a-provider", "sk-x", Some(&agent))
            .await
            .is_err());
        assert!(set_pi_auth_api_key("openai", "   ", Some(&agent))
            .await
            .is_err());
        assert!(set_pi_auth_api_key("openai", "sk-a\nsk-b", Some(&agent))
            .await
            .is_err());
        assert!(set_pi_auth_api_key("github-copilot", "sk-x", Some(&agent))
            .await
            .is_err());
        assert!(!dir.join("auth.json").exists());
    }
}
