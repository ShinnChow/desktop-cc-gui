use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageDay {
    pub(crate) day: String,
    pub(crate) input_tokens: i64,
    pub(crate) cached_input_tokens: i64,
    pub(crate) output_tokens: i64,
    pub(crate) total_tokens: i64,
    #[serde(default)]
    pub(crate) agent_time_ms: i64,
    #[serde(default)]
    pub(crate) agent_runs: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageTotals {
    pub(crate) last7_days_tokens: i64,
    pub(crate) last30_days_tokens: i64,
    pub(crate) average_daily_tokens: i64,
    pub(crate) cache_hit_rate_percent: f64,
    pub(crate) peak_day: Option<String>,
    pub(crate) peak_day_tokens: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageModel {
    pub(crate) model: String,
    pub(crate) tokens: i64,
    pub(crate) share_percent: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageSnapshot {
    pub(crate) updated_at: i64,
    pub(crate) days: Vec<LocalUsageDay>,
    pub(crate) totals: LocalUsageTotals,
    #[serde(default)]
    pub(crate) top_models: Vec<LocalUsageModel>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageUsageData {
    pub(crate) input_tokens: i64,
    pub(crate) output_tokens: i64,
    pub(crate) cache_write_tokens: i64,
    pub(crate) cache_read_tokens: i64,
    pub(crate) total_tokens: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageSessionSummary {
    pub(crate) session_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) session_id_aliases: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) parent_session_id: Option<String>,
    pub(crate) timestamp: i64,
    #[serde(default)]
    pub(crate) cwd: Option<String>,
    pub(crate) model: String,
    pub(crate) usage: LocalUsageUsageData,
    pub(crate) cost: f64,
    #[serde(default)]
    pub(crate) summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) native_title: Option<String>,
    #[serde(default)]
    pub(crate) source: Option<String>,
    #[serde(default)]
    pub(crate) provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_profile_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_profile_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_profile_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_availability: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) physical_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) file_size_bytes: Option<u64>,
    #[serde(default)]
    pub(crate) modified_lines: i64,
}

