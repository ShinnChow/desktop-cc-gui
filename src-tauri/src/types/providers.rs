use serde::{Deserialize, Serialize};

// ==================== Vendor/Provider Types ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) remark: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) website_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) sort_order: Option<i64>,
    #[serde(default)]
    pub(crate) is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) is_local_provider: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) settings_config: Option<serde_json::Value>,
    /// Provider-owned custom models (symmetric with CodexProviderConfig).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) custom_models: Option<Vec<CodexCustomModel>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexCustomModel {
    pub(crate) id: String,
    pub(crate) label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexProviderConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) remark: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) sort_order: Option<i64>,
    #[serde(default)]
    pub(crate) is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) config_toml: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) auth_json: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) custom_models: Option<Vec<CodexCustomModel>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KimiProviderConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) remark: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) website_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) sort_order: Option<i64>,
    #[serde(default)]
    pub(crate) is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) is_local_provider: Option<bool>,
    #[serde(default)]
    pub(crate) base_url: String,
    #[serde(default)]
    pub(crate) api_key: String,
    #[serde(default)]
    pub(crate) model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) max_context_size: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) display_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrokProviderConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) remark: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) website_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) sort_order: Option<i64>,
    #[serde(default)]
    pub(crate) is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) is_local_provider: Option<bool>,
    #[serde(default)]
    pub(crate) base_url: String,
    #[serde(default)]
    pub(crate) api_key: String,
    #[serde(default)]
    pub(crate) model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) max_context_size: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) display_name: Option<String>,
    /// API/wire backend: "chat_completions" | "responses" | "messages".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) api_backend: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenCodeProviderConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) remark: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) website_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) sort_order: Option<i64>,
    #[serde(default)]
    pub(crate) is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) is_local_provider: Option<bool>,
    #[serde(default)]
    pub(crate) base_url: String,
    #[serde(default)]
    pub(crate) api_key: String,
    /// Model ids exposed by this provider (e.g. `provider/model` slugs).
    #[serde(default)]
    pub(crate) models: Vec<String>,
}

