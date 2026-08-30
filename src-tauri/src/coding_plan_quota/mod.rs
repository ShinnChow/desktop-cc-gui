//! Coding Plan / Token Plan / Provider Balance 额度查询。
//!
//! 按供应商 base_url 识别套餐域：
//! - 百分比窗口：Kimi For Coding、MiniMax、智谱 GLM
//! - 货币余额：DeepSeek（官方 GET /user/balance）
//! - 未知第三方中转：Sub2API 兼容 `GET {origin}/v1/usage`（余额 + 可选额度窗）

mod types;
mod snapshot;
mod providers;
mod relay;
mod credentials;
mod host_cli;
mod pi_usage;
mod commands;

pub(crate) use commands::*;
#[cfg(test)]
pub(crate) use commands::get_coding_plan_quota_for_session;
#[cfg(test)]
pub(crate) use credentials::{
    extract_codex_base_url_and_key, is_official_grok_base, kimi_cli_token_needs_refresh,
    pick_base_url_api_key, resolve_engine_base_url_and_key, resolve_grok_base_url_and_key,
    resolve_quota_route, KimiCliCredentials,
};
#[cfg(test)]
pub(crate) use host_cli::{
    host_cli_vendor_id, resolve_dsh_base_url_and_key_from_home,
    resolve_pi_base_url_and_key_from_home,
};
#[cfg(test)]
pub(crate) use providers::{
    is_official_anthropic_base, is_official_openai_base, parse_deepseek_balance,
    parse_minimax_windows, parse_zhipu_windows,
};
#[cfg(test)]
pub(crate) use relay::{
    format_quota_amount, new_api_user_self_url, parse_new_api_user_self, parse_sub2api_usage,
    pick_better_relay_error, relay_origin, sub2api_usage_url,
};
#[cfg(test)]
pub(crate) use snapshot::{
    detect_provider, empty_snapshot_ex, is_dashscope_coding_plan_host, relay_user_error,
};
#[cfg(test)]
pub(crate) use types::{CodingPlanProvider, QuotaRoute};

#[cfg(test)]
mod tests;
