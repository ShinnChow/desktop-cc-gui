pub(super) const LEDGER_FILE_NAME: &str = "runtime-pool-ledger.json";
pub(super) const TERMINATE_GRACE_MILLIS: u64 = 150;
pub(crate) const RUNTIME_ACQUIRE_WAIT_TIMEOUT_SECS: u64 = 5;
pub(crate) const RUNTIME_RECOVERY_MAX_CONSECUTIVE_FAILURES: u8 = 3;
pub(crate) const RUNTIME_RECOVERY_RETRY_BACKOFF_MILLIS: u64 = 250;
pub(crate) const RUNTIME_RECOVERY_QUARANTINE_MILLIS: u64 = 15_000;
pub(super) const RUNTIME_CHURN_WINDOW_MILLIS: u64 = 30_000;
pub(super) const THREAD_CREATE_PENDING_SENTINEL: &str = "__thread-create-pending__";
