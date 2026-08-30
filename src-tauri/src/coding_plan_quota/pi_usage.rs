//! PI 的 `openai-codex` OAuth 用量查询。
//!
//! PI 使用与 Codex CLI 相同的 ChatGPT OAuth credential；这里沿用 Codex 的
//! `GET /backend-api/wham/usage` contract，而不是再定义一套额度协议。

use serde_json::Value;

use super::host_cli::read_pi_openai_codex_auth;
use super::providers::http_client;
use super::snapshot::{empty_snapshot, extract_reset_time, now_millis};
use super::types::{CodingPlanQuotaSnapshot, CodingPlanQuotaWindow};

const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_ORIGINATOR: &str = "codex_cli_rs";

pub(crate) async fn query_pi_openai_codex_usage() -> CodingPlanQuotaSnapshot {
    let (token, account_id) = match read_pi_openai_codex_auth() {
        Ok(auth) => auth,
        Err(error) => return empty_snapshot("pi", Some(error)),
    };
    let client = match http_client() {
        Ok(client) => client,
        Err(error) => return empty_snapshot("pi", Some(error)),
    };

    let response = match client
        .get(CODEX_USAGE_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("chatgpt-account-id", account_id)
        .header("originator", CODEX_ORIGINATOR)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return empty_snapshot("pi", Some(format!("Network error: {error}"))),
    };
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return empty_snapshot("pi", Some(format!("Authentication failed (HTTP {status})")));
    }
    if !status.is_success() {
        return empty_snapshot("pi", Some(format!("API error (HTTP {status})")));
    }
    let body = match response.json::<Value>().await {
        Ok(body) => body,
        Err(error) => {
            return empty_snapshot("pi", Some(format!("Failed to parse response: {error}")))
        }
    };
    let mut snapshot = parse_pi_openai_codex_usage(&body);
    snapshot.queried_at = now_millis();
    snapshot
}

pub(crate) fn parse_pi_openai_codex_usage(body: &Value) -> CodingPlanQuotaSnapshot {
    let rate_limit = body.get("rate_limit").unwrap_or(body);
    let windows = [
        ("primary", rate_limit.get("primary_window")),
        ("secondary", rate_limit.get("secondary_window")),
    ]
    .into_iter()
    .filter_map(|(id, window)| parse_window(id, window))
    .collect();

    CodingPlanQuotaSnapshot {
        source: "pi".to_string(),
        via: Some("codex_cli".to_string()),
        success: true,
        error: None,
        plan_label: body
            .get("plan_type")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
        windows,
        balance: None,
        usage_summary: None,
        site_origin: None,
        queried_at: now_millis(),
    }
}

fn parse_window(id: &str, window: Option<&Value>) -> Option<CodingPlanQuotaWindow> {
    let window = window?;
    let used_percent = window
        .get("used_percent")
        .and_then(Value::as_f64)
        .or_else(|| window.get("usedPercent").and_then(Value::as_f64))?;
    Some(CodingPlanQuotaWindow {
        id: id.to_string(),
        used_percent,
        remaining_percent: (100.0 - used_percent).clamp(0.0, 100.0),
        resets_at: window
            .get("reset_at")
            .or_else(|| window.get("resetAt"))
            .and_then(extract_reset_time),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::parse_pi_openai_codex_usage;

    #[test]
    fn maps_codex_usage_windows() {
        let snapshot = parse_pi_openai_codex_usage(&json!({
            "plan_type": "pro",
            "rate_limit": {
                "primary_window": { "used_percent": 25.0, "reset_at": 1_800_000_000 },
                "secondary_window": { "used_percent": 60.0, "reset_at": "2027-01-01T00:00:00Z" }
            }
        }));

        assert!(snapshot.success);
        assert_eq!(snapshot.source, "pi");
        assert_eq!(snapshot.via.as_deref(), Some("codex_cli"));
        assert_eq!(snapshot.plan_label.as_deref(), Some("pro"));
        assert_eq!(snapshot.windows.len(), 2);
        assert_eq!(snapshot.windows[0].id, "primary");
        assert_eq!(snapshot.windows[0].used_percent, 25.0);
        assert_eq!(snapshot.windows[1].id, "secondary");
        assert_eq!(snapshot.windows[1].used_percent, 60.0);
    }
}
