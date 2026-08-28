use super::credentials::{query_kimi_cli_status, resolve_quota_route};
use super::pi_usage::query_pi_openai_codex_usage;
use super::relay::query_by_base_url_and_key;
use super::snapshot::*;
use super::types::*;

/// 按当前会话引擎 + provider profile 解析路由并查询额度。
/// 原则：
/// - `engine=kimi`（Kimi CLI 本体）→ CLI OAuth refresh + `/usages`，via=cli（对齐 `/status`）
/// - `engine=qoder` → unsupported。qodercli 无 account/rateLimits RPC、无 /usages HTTP、
///   `status -o json` 不含套餐额度；账户额度只在 TUI `/usage`。不刮 TUI、不读 ~/.qoder。
/// - Claude/Codex + Kimi/MiniMax/… HTTP 中转 → CodingPlanApi + API key，via=api
pub(crate) async fn get_coding_plan_quota_for_session(
    engine: &str,
    provider_profile_id: Option<&str>,
) -> CodingPlanQuotaSnapshot {
    let engine_lc = engine.trim().to_ascii_lowercase();

    // Kimi CLI 引擎单独路径：只读 ~/.kimi-code 登录态（含 refresh），不走 managed API key。
    // Claude Code / Codex 绑 Kimi HTTP 不会命中这里（engine 是 claude/codex）。
    if engine_lc == "kimi" {
        return query_kimi_cli_status().await;
    }

    // PI 的 `openai-codex` OAuth 直接复用 Codex CLI 的 ChatGPT usage endpoint。
    // 不能走 PI 的 base_url + api_key 路径：OAuth entry 没有 API key。
    if engine_lc == "pi"
        && matches!(
            provider_profile_id,
            None | Some("openai") | Some("openai-codex")
        )
    {
        return query_pi_openai_codex_usage().await;
    }

    if engine_lc == "qoder" {
        return empty_snapshot(
            "unsupported",
            Some(
                "Qoder CLI 没有可查询的账户额度接口（无 account/rateLimits、无 /usages HTTP）。请在 qodercli 内使用 /usage 查看。"
                    .to_string(),
            ),
        );
    }

    match resolve_quota_route(engine, provider_profile_id) {
        QuotaRoute::OfficialRuntime { source } => CodingPlanQuotaSnapshot {
            source: source.to_string(),
            via: Some("official_runtime".to_string()),
            success: true,
            error: None,
            plan_label: None,
            windows: vec![],
            balance: None,
            usage_summary: None,
            site_origin: None,
            queried_at: now_millis(),
        },
        QuotaRoute::CodingPlanApi { base_url, api_key } => {
            let mut snapshot = query_by_base_url_and_key(&base_url, &api_key).await;
            // HTTP 中转路径（含 Claude/Codex + Kimi API key）统一 via=api
            if snapshot.via.is_none() && snapshot.success {
                snapshot.via = Some("api".to_string());
            }
            snapshot
        }
        QuotaRoute::None { reason } => {
            // 官方 Claude / Grok 无 plan：用 none 而非 unsupported，UI 可隐藏
            if reason == "official_anthropic_no_coding_plan"
                || reason == "official_openai_no_coding_plan"
                || reason == "official_grok_no_coding_plan"
            {
                return CodingPlanQuotaSnapshot {
                    source: "none".to_string(),
                    via: Some("official_runtime".to_string()),
                    success: true,
                    error: None,
                    plan_label: None,
                    windows: vec![],
                    balance: None,
                    usage_summary: None,
                    site_origin: None,
                    queried_at: now_millis(),
                };
            }
            // 「credentials not found」优先 empty_credentials，避免被 not found 误判为 unsupported。
            // 中文 user error（API 密钥为空 / 未配置服务地址）不含英文 empty，必须对 canonical 文案。
            empty_snapshot(classify_quota_none_source(&reason), Some(reason))
        }
    }
}

pub(crate) fn classify_quota_none_source(reason: &str) -> &'static str {
    if is_empty_credentials_reason(reason) {
        "empty_credentials"
    } else if reason.contains("not a known") || reason.contains("not found") {
        "unsupported"
    } else {
        "empty"
    }
}

fn is_empty_credentials_reason(reason: &str) -> bool {
    reason == relay_user_error("empty_key")
        || reason == relay_user_error("empty_base")
        || reason == relay_user_error("missing_creds")
        || reason.contains("missing")
        || reason.contains("empty")
        || reason.contains("credentials")
        || reason.contains("login")
}

/// 直接用 base_url + api_key 查询（调试 / 前端已有凭据时）。
pub(crate) async fn get_coding_plan_quota_direct(
    base_url: &str,
    api_key: &str,
) -> CodingPlanQuotaSnapshot {
    query_by_base_url_and_key(base_url, api_key).await
}

#[tauri::command]
pub(crate) async fn get_coding_plan_quota(
    engine: String,
    provider_profile_id: Option<String>,
) -> Result<CodingPlanQuotaSnapshot, String> {
    Ok(get_coding_plan_quota_for_session(&engine, provider_profile_id.as_deref()).await)
}

#[tauri::command]
pub(crate) async fn get_coding_plan_quota_direct_cmd(
    base_url: String,
    api_key: String,
) -> Result<CodingPlanQuotaSnapshot, String> {
    Ok(get_coding_plan_quota_direct(&base_url, &api_key).await)
}
