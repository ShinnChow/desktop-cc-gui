//! DSH host transport breaker（perf-cold-start-click-storm-convergence F4）。
//!
//! 宿主不可达（daemon 未启动 / 端口拒绝 / 网络 Drop）时，传输层连续失败达到
//! 阈值即 open：open 期内宿主 RPC **不发 HTTP**，直接返回结构化 Down 错误串
//! `dsh host.down {"reason":"breaker-open","retryAfterMs":N}`，前端据此跳过
//! 重试、走 V0/本地可读回退。冷却到期放行**一次**半开探测：成功 close，
//! 失败重开。只统计传输层失败（send error / 超时）——HTTP 4xx/5xx 与信封
//! 解析错误证明宿主活着，按成功处理（重置连续计数）。
//!
//! 状态机纯逻辑、`now_ms` 注入，单测不依赖时钟与网络。

use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

/// 结构化 Down 错误前缀；前端 `parseDshHostDownError` 依赖此常量语义。
pub const DSH_HOST_DOWN_PREFIX: &str = "dsh host.down ";
pub const BREAKER_FAILURE_THRESHOLD: u32 = 2;
pub const BREAKER_COOLDOWN_MS: i64 = 60_000;

pub struct DshTransportBreaker {
    consecutive_transport_failures: AtomicU32,
    open_until_ms: AtomicI64,
    probe_in_flight: AtomicBool,
}

impl Default for DshTransportBreaker {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for DshTransportBreaker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DshTransportBreaker")
            .field(
                "consecutive_transport_failures",
                &self.consecutive_transport_failures.load(Ordering::Relaxed),
            )
            .field("open_until_ms", &self.open_until_ms.load(Ordering::Relaxed))
            .field(
                "probe_in_flight",
                &self.probe_in_flight.load(Ordering::Relaxed),
            )
            .finish()
    }
}

impl DshTransportBreaker {
    pub fn new() -> Self {
        Self {
            consecutive_transport_failures: AtomicU32::new(0),
            open_until_ms: AtomicI64::new(0),
            probe_in_flight: AtomicBool::new(false),
        }
    }

    pub fn system_now_ms() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0)
    }

    /// 请求放行闸门：closed → Ok；open 且未到冷却 → Err(结构化 Down)；
    /// 冷却到期 → 恰好放行一个半开探测名额（其余仍 Err）。
    pub fn acquire(&self, now_ms: i64) -> Result<(), String> {
        if self.consecutive_transport_failures.load(Ordering::Acquire) < BREAKER_FAILURE_THRESHOLD {
            return Ok(());
        }
        let open_until_ms = self.open_until_ms.load(Ordering::Acquire);
        if now_ms < open_until_ms {
            return Err(self.down_error(open_until_ms.saturating_sub(now_ms)));
        }
        if self.probe_in_flight.swap(true, Ordering::AcqRel) {
            return Err(self.down_error(0));
        }
        Ok(())
    }

    /// 收到任何响应（含 HTTP 4xx/5xx、信封错误）都证明宿主可达。
    pub fn record_success(&self) {
        self.consecutive_transport_failures
            .store(0, Ordering::Release);
        self.open_until_ms.store(0, Ordering::Release);
        self.probe_in_flight.store(false, Ordering::Release);
    }

    pub fn record_transport_failure(&self, now_ms: i64) {
        let failures = self
            .consecutive_transport_failures
            .fetch_add(1, Ordering::AcqRel)
            + 1;
        if failures >= BREAKER_FAILURE_THRESHOLD {
            self.open_until_ms.store(
                now_ms.saturating_add(BREAKER_COOLDOWN_MS),
                Ordering::Release,
            );
        }
        self.probe_in_flight.store(false, Ordering::Release);
    }

    /// 设置页显式「重测」等入口的强制复位。
    pub fn reset(&self) {
        self.record_success();
    }

    fn down_error(&self, retry_after_ms: i64) -> String {
        dsh_host_down_error("breaker-open", retry_after_ms)
    }
}

pub fn dsh_host_down_error(reason: &str, retry_after_ms: i64) -> String {
    format!(
        "{DSH_HOST_DOWN_PREFIX}{{\"reason\":\"{reason}\",\"retryAfterMs\":{}}}",
        retry_after_ms.max(0)
    )
}

pub type SharedBreaker = Arc<DshTransportBreaker>;

/// 按 origin 全局共享（`client_for_snapshot` 每次新建客户端实例，
/// 熔断状态必须落在实例之外）。
static BREAKERS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, SharedBreaker>>,
> = std::sync::OnceLock::new();

pub fn breaker_for_origin(origin: &str) -> SharedBreaker {
    let origin = origin.trim().trim_end_matches('/').to_string();
    let registry = BREAKERS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    let mut guard = registry.lock().expect("dsh breaker registry poisoned");
    guard
        .entry(origin)
        .or_insert_with(|| Arc::new(DshTransportBreaker::new()))
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closed_breaker_allows_requests() {
        let breaker = DshTransportBreaker::new();
        assert!(breaker.acquire(1_000).is_ok());
    }

    #[test]
    fn single_transport_failure_stays_closed() {
        let breaker = DshTransportBreaker::new();
        breaker.record_transport_failure(1_000);
        assert!(breaker.acquire(1_100).is_ok());
    }

    #[test]
    fn opens_after_consecutive_transport_failures() {
        let breaker = DshTransportBreaker::new();
        breaker.record_transport_failure(1_000);
        breaker.record_transport_failure(1_500);
        let error = breaker.acquire(1_600).unwrap_err();
        assert!(
            error.starts_with(DSH_HOST_DOWN_PREFIX),
            "unexpected: {error}"
        );
        assert!(error.contains("\"reason\":\"breaker-open\""));
        assert!(error.contains("\"retryAfterMs\":"));
    }

    #[test]
    fn http_level_response_resets_consecutive_failures() {
        let breaker = DshTransportBreaker::new();
        breaker.record_transport_failure(1_000);
        breaker.record_success();
        breaker.record_transport_failure(2_000);
        assert!(
            breaker.acquire(2_100).is_ok(),
            "non-consecutive failures must not open"
        );
    }

    #[test]
    fn retry_after_counts_down_inside_cooldown() {
        let breaker = DshTransportBreaker::new();
        breaker.record_transport_failure(1_000);
        breaker.record_transport_failure(1_500);
        let error = breaker.acquire(2_000).unwrap_err();
        assert!(
            error.contains("\"retryAfterMs\":59500"),
            "unexpected: {error}"
        );
    }

    #[test]
    fn half_open_grants_exactly_one_probe_after_cooldown() {
        let breaker = DshTransportBreaker::new();
        breaker.record_transport_failure(1_000);
        breaker.record_transport_failure(1_500);
        let probe_at = 1_500 + BREAKER_COOLDOWN_MS;
        assert!(
            breaker.acquire(probe_at).is_ok(),
            "cooldown expiry must grant one probe"
        );
        assert!(
            breaker.acquire(probe_at).is_err(),
            "concurrent callers must not get a second probe slot"
        );
        breaker.record_success();
        assert!(
            breaker.acquire(probe_at + 1).is_ok(),
            "probe success must close breaker"
        );
    }

    #[test]
    fn probe_failure_reopens_for_full_cooldown() {
        let breaker = DshTransportBreaker::new();
        breaker.record_transport_failure(1_000);
        breaker.record_transport_failure(1_500);
        let probe_at = 1_500 + BREAKER_COOLDOWN_MS;
        assert!(breaker.acquire(probe_at).is_ok());
        breaker.record_transport_failure(probe_at + 100);
        let error = breaker.acquire(probe_at + 200).unwrap_err();
        assert!(error.contains("\"retryAfterMs\":"), "unexpected: {error}");
        // 重开从「探针失败时刻」起算完整冷却。
        let reopen_at = probe_at + 100 + BREAKER_COOLDOWN_MS;
        assert!(breaker.acquire(reopen_at - 1).is_err());
        assert!(breaker.acquire(reopen_at).is_ok());
    }

    #[test]
    fn reset_forces_closed() {
        let breaker = DshTransportBreaker::new();
        breaker.record_transport_failure(1_000);
        breaker.record_transport_failure(1_500);
        assert!(breaker.acquire(1_600).is_err());
        breaker.reset();
        assert!(breaker.acquire(1_600).is_ok());
    }

    #[test]
    fn down_error_json_is_parseable() {
        let text = dsh_host_down_error("breaker-open", 42);
        let payload = text.strip_prefix(DSH_HOST_DOWN_PREFIX).unwrap();
        let value: serde_json::Value = serde_json::from_str(payload).unwrap();
        assert_eq!(value["reason"], "breaker-open");
        assert_eq!(value["retryAfterMs"], 42);
    }

    #[test]
    fn breaker_registry_is_shared_per_origin() {
        let a = breaker_for_origin("http://127.0.0.1:3080");
        let b = breaker_for_origin("http://127.0.0.1:3080/");
        let c = breaker_for_origin("http://127.0.0.1:9999");
        assert!(
            Arc::ptr_eq(&a, &b),
            "same origin (trailing slash normalized) must share breaker"
        );
        assert!(
            !Arc::ptr_eq(&a, &c),
            "different origin must not share breaker"
        );
        // 全局注册表被本测试与并发测试共同写入，不做跨测试断言。
    }
}
