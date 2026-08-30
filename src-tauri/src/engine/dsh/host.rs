//! DSH Host RPC unary client.
//!
//! Wire: `POST /api/<method>` with
//! `{type:"client-request",rpcId,method,payload}` →
//! `{type:"server-response",rpcId,result:{ok:true,value}|{ok:false,error}}`.
//! Approvals/questions settle via `POST /api/respond`.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use uuid::Uuid;

use super::breaker::{breaker_for_origin, DshTransportBreaker, SharedBreaker};

const RPC_TIMEOUT: Duration = Duration::from_secs(30);
const DESCRIBE_TIMEOUT: Duration = Duration::from_secs(3);
// 宿主离线（daemon 未启动 / 端口拒绝 / 防火墙 Drop）时连接阶段的快速失败上限；
// refused 本就秒回，这里主要收掉「Drop 不回包」场景下挂在总超时上的等待。
const CONNECT_TIMEOUT: Duration = Duration::from_millis(800);

#[derive(Debug, Clone)]
pub struct DshHostClient {
    http: Client,
    origin: String,
    // 按 origin 全局共享（client_for_snapshot 每次新建实例，熔断状态必须落在实例之外）。
    breaker: SharedBreaker,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DshRpcError {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub details: Value,
}

impl std::fmt::Display for DshRpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", format_dsh_rpc_error(self))
    }
}

/// DSH Host admits images from `resolveModelInfo().inputModalities`.
/// mossx declares `[text, image]` on writable `llm-pi-ai` routes before
/// prompt; this mapping is only the leftover case (read-only host, official
/// text-only adapter, or the upstream still refused after that declaration).
fn format_dsh_rpc_error(error: &DshRpcError) -> String {
    let reason = error.details.get("reason").and_then(Value::as_str);
    if error.code == "attachment-error" && reason == Some("MODEL_DOES_NOT_SUPPORT_IMAGES") {
        return format!(
            "{}: {} mossx already tries to declare image input on custom llm-pi-ai routes. This leftover refusal means the host is read-only, the adapter is not llm-pi-ai, or the endpoint itself rejected the image. Open DSH Settings only if this host is not writable from mossx.",
            error.code, error.message
        );
    }
    format!("{}: {}", error.code, error.message)
}

impl std::error::Error for DshRpcError {}

#[derive(Debug, Deserialize)]
struct ServerResponseEnvelope {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default, rename = "rpcId")]
    rpc_id: Option<String>,
    result: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct RpcOk {
    ok: bool,
    #[serde(default)]
    value: Value,
    #[serde(default)]
    error: Option<DshRpcError>,
}

impl DshHostClient {
    pub fn new(origin: impl Into<String>) -> Result<Self, String> {
        let http = Client::builder()
            .timeout(RPC_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .map_err(|error| format!("dsh http client: {error}"))?;
        let origin = origin.into().trim_end_matches('/').to_string();
        let breaker = breaker_for_origin(&origin);
        Ok(Self {
            http,
            origin,
            breaker,
        })
    }

    pub fn origin(&self) -> &str {
        &self.origin
    }

    pub fn breaker(&self) -> &SharedBreaker {
        &self.breaker
    }

    pub fn mux_url(&self) -> String {
        mux_url_from_origin(&self.origin)
    }

    pub fn settings_url(&self) -> String {
        self.origin.clone()
    }

    pub async fn describe(&self) -> Result<Value, String> {
        self.call_with_timeout("host.describe", json!({}), DESCRIBE_TIMEOUT)
            .await
    }

    pub async fn call(&self, method: &str, payload: Value) -> Result<Value, String> {
        self.call_with_timeout(method, payload, RPC_TIMEOUT).await
    }

    pub async fn respond(&self, rpc_id: &str, value: Value) -> Result<Value, String> {
        self.respond_result(rpc_id, json!({ "ok": true, "value": value }))
            .await
    }

    pub async fn respond_error(
        &self,
        rpc_id: &str,
        code: &str,
        message: &str,
    ) -> Result<Value, String> {
        self.respond_result(
            rpc_id,
            json!({
                "ok": false,
                "error": {
                    "code": code,
                    "message": message,
                    "details": {},
                },
            }),
        )
        .await
    }

    async fn respond_result(&self, rpc_id: &str, result: Value) -> Result<Value, String> {
        let body = json!({
            "type": "client-response",
            "rpcId": rpc_id,
            "result": result,
        });
        let url = format!("{}/api/respond", self.origin);
        let response = self
            .http
            .post(url)
            .json(&body)
            .send()
            .await
            .map_err(|error| format!("dsh respond transport: {error}"))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|error| format!("dsh respond body: {error}"))?;
        if !status.is_success() {
            return Err(format!("dsh respond HTTP {status}: {text}"));
        }
        let receipt: Value =
            serde_json::from_str(&text).map_err(|error| format!("dsh respond json: {error}"))?;
        interpret_respond_receipt(&receipt)?;
        Ok(receipt)
    }

    async fn call_with_timeout(
        &self,
        method: &str,
        payload: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let rpc_id = Uuid::new_v4().to_string();
        let body = json!({
            "type": "client-request",
            "rpcId": rpc_id,
            "method": method,
            "payload": payload,
        });
        let url = format!("{}/api/{method}", self.origin);
        // 熔断 open 期内不发 HTTP，直接结构化快速失败
        // （`dsh host.down {"reason":"breaker-open",...}`，前端 parseDshHostDownError 识别）。
        if let Err(down) = self.breaker.acquire(DshTransportBreaker::system_now_ms()) {
            return Err(down);
        }
        let response =
            match tokio::time::timeout(timeout, self.http.post(url).json(&body).send()).await {
                // 任何响应（含 HTTP 4xx/5xx、信封错误）都证明宿主可达：重置连续失败。
                Ok(Ok(response)) => {
                    self.breaker.record_success();
                    response
                }
                Ok(Err(error)) => {
                    self.breaker
                        .record_transport_failure(DshTransportBreaker::system_now_ms());
                    return Err(format!("dsh {method} transport: {error}"));
                }
                Err(_) => {
                    self.breaker
                        .record_transport_failure(DshTransportBreaker::system_now_ms());
                    return Err(format!("dsh {method} timed out"));
                }
            };
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|error| format!("dsh {method} body: {error}"))?;
        if !status.is_success() {
            return Err(format!("dsh {method} HTTP {status}: {text}"));
        }
        parse_server_response(&text, &rpc_id, method)
    }
}

pub fn parse_server_response(
    text: &str,
    expected_rpc_id: &str,
    method: &str,
) -> Result<Value, String> {
    let envelope: ServerResponseEnvelope =
        serde_json::from_str(text).map_err(|error| format!("dsh {method} envelope: {error}"))?;
    if envelope.kind != "server-response" {
        return Err(format!(
            "dsh {method}: expected server-response, got {}",
            envelope.kind
        ));
    }
    if let Some(rpc_id) = envelope.rpc_id.as_deref() {
        if rpc_id != expected_rpc_id {
            return Err(format!(
                "dsh {method}: rpcId mismatch ({rpc_id} != {expected_rpc_id})"
            ));
        }
    }
    let Some(result) = envelope.result else {
        return Err(format!("dsh {method}: missing result"));
    };
    let parsed: RpcOk =
        serde_json::from_value(result).map_err(|error| format!("dsh {method} result: {error}"))?;
    if parsed.ok {
        return Ok(parsed.value);
    }
    let error = parsed.error.unwrap_or(DshRpcError {
        code: "unknown".to_string(),
        message: format!("{method} failed"),
        details: Value::Null,
    });
    Err(error.to_string())
}

pub fn origin_from_host_port(host: &str, port: u16) -> String {
    format!("http://{host}:{port}")
}

fn interpret_respond_receipt(value: &Value) -> Result<(), String> {
    if value.get("accepted").and_then(Value::as_bool) == Some(false) {
        let reason = value
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or("bad-response");
        return Err(format!("dsh respond rejected: {reason}"));
    }
    Ok(())
}

pub fn mux_url_from_origin(origin: &str) -> String {
    let origin = origin.trim().trim_end_matches('/');
    if let Some(rest) = origin.strip_prefix("https://") {
        return format!("wss://{rest}/api/events.mux");
    }
    if let Some(rest) = origin.strip_prefix("http://") {
        return format!("ws://{rest}/api/events.mux");
    }
    format!("ws://{origin}/api/events.mux")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_shares_breaker_per_origin() {
        let client = DshHostClient::new("http://127.0.0.1:43111").unwrap();
        let other = DshHostClient::new("http://127.0.0.1:43111/").unwrap();
        assert!(
            std::sync::Arc::ptr_eq(client.breaker(), other.breaker()),
            "same origin clients must share the breaker"
        );
        assert!(std::sync::Arc::ptr_eq(
            client.breaker(),
            &breaker_for_origin("http://127.0.0.1:43111"),
        ));
    }

    #[test]
    fn parses_ok_envelope() {
        let rpc_id = "rpc-1";
        let body = r#"{"type":"server-response","rpcId":"rpc-1","result":{"ok":true,"value":{"sessionId":"session-1"}}}"#;
        let value = parse_server_response(body, rpc_id, "session.create").unwrap();
        assert_eq!(value["sessionId"], "session-1");
    }

    #[test]
    fn parses_error_envelope() {
        let body = r#"{"type":"server-response","rpcId":"rpc-1","result":{"ok":false,"error":{"code":"fork-unavailable","message":"turn open","details":{}}}}"#;
        let err = parse_server_response(body, "rpc-1", "session.fork").unwrap_err();
        assert!(err.contains("fork-unavailable"));
    }

    #[test]
    fn explains_model_does_not_support_images_as_resolved_declaration() {
        let body = r#"{"type":"server-response","rpcId":"rpc-1","result":{"ok":false,"error":{"code":"attachment-error","message":"Model \"grok-4.5\" does not support image input.","details":{"reason":"MODEL_DOES_NOT_SUPPORT_IMAGES"}}}}"#;
        let err = parse_server_response(body, "rpc-1", "session.prompt").unwrap_err();
        assert!(err.contains("attachment-error"), "unexpected error: {err}");
        assert!(err.contains("grok-4.5"), "unexpected error: {err}");
        assert!(
            err.contains("declare image input"),
            "unexpected error: {err}"
        );
        assert!(
            !err.contains("set `input: [text, image]`"),
            "must not tell every user to hand-edit DSH settings: {err}"
        );
    }

    #[test]
    fn other_attachment_errors_stay_unmapped() {
        let body = r#"{"type":"server-response","rpcId":"rpc-1","result":{"ok":false,"error":{"code":"attachment-error","message":"too many","details":{"reason":"TOO_MANY_IMAGES"}}}}"#;
        let err = parse_server_response(body, "rpc-1", "session.prompt").unwrap_err();
        assert_eq!(err, "attachment-error: too many");
    }

    #[test]
    fn rejects_wrong_type() {
        let body = r#"{"type":"client-request","rpcId":"rpc-1","method":"x","payload":{}}"#;
        let err = parse_server_response(body, "rpc-1", "x").unwrap_err();
        assert!(err.contains("expected server-response"));
    }

    #[test]
    fn rejected_receipt_surfaces_reason() {
        let err = interpret_respond_receipt(&json!({
            "accepted": false,
            "reason": "bad-response"
        }))
        .unwrap_err();
        assert_eq!(err, "dsh respond rejected: bad-response");
        interpret_respond_receipt(&json!({ "accepted": true })).unwrap();
    }

    #[test]
    fn mux_url_maps_http_and_https() {
        assert_eq!(
            mux_url_from_origin("http://127.0.0.1:3080"),
            "ws://127.0.0.1:3080/api/events.mux"
        );
        assert_eq!(
            mux_url_from_origin("https://dsh.example:8443/"),
            "wss://dsh.example:8443/api/events.mux"
        );
    }
}
