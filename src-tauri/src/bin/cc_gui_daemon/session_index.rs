// session_management.rs 的删除核心在收口时会打 session index tombstone；
// daemon 没有本地 SQLite index（web 模式走 legacy list），用 no-op 保持
// 共享核心可编译，行为与桌面端一致（桌面端走完整 session_index 模块）。
#[allow(dead_code)]
pub(crate) mod commands {
    pub(crate) async fn tombstone_session_index_rows(
        _session_ids: Vec<String>,
    ) -> Result<u32, String> {
        Ok(0)
    }
}

// session_management overlay types; daemon has no SQLite index.
pub(crate) mod store {
    #[derive(Debug, Clone, Default)]
    pub struct SessionIndexRow {
        pub engine: String,
        pub session_id: String,
        pub title: String,
        pub native_title: Option<String>,
        pub updated_at: i64,
        pub created_at: Option<i64>,
        pub cwd: Option<String>,
        pub workspace_path: Option<String>,
        pub physical_path: Option<String>,
        pub parent_session_id: Option<String>,
        pub size_bytes: Option<u64>,
        pub provider_profile_id: Option<String>,
        pub provider_profile_name: Option<String>,
    }

    pub(crate) const INDEX_LIST_ENGINES: &[&str] = &[
        "claude", "codex", "gemini", "grok", "kimi", "opencode", "pi", "omp", "dsh", "qoder",
    ];

    #[derive(Debug, Clone)]
    pub(crate) struct SessionIndexDeleteLookup {
        pub(crate) row: SessionIndexRow,
        pub(crate) tombstoned_at: Option<i64>,
    }

    /// daemon 无本地 SQLite index：open 恒失败，archive v2 resolve 走
    /// engine 前缀定向 + 请求 workspace 回退（与桌面端 index miss 同语义）。
    pub(crate) struct DaemonUnavailableConnection;

    pub(crate) fn open_connection() -> Result<DaemonUnavailableConnection, String> {
        Err("daemon has no local session index".to_string())
    }

    pub(crate) fn lookup_rows_for_delete(
        _connection: &DaemonUnavailableConnection,
        _full_id: &str,
    ) -> Result<Vec<SessionIndexDeleteLookup>, String> {
        Ok(Vec::new())
    }
}

// tombstone_filter no-op：daemon 无本地 index，过滤器恒空（与桌面端
// fail-open 语义一致，共享的 session_management 出口过滤编译可用）。
pub(crate) mod tombstone_filter {
    #[derive(Debug, Default)]
    pub(crate) struct TombstoneFilter;

    impl TombstoneFilter {
        pub(crate) fn load_fail_open() -> Self {
            Self
        }

        pub(crate) fn is_empty(&self) -> bool {
            true
        }

        pub(crate) fn is_tombstoned(&self, _engine: &str, _session_id: &str) -> bool {
            false
        }

        #[allow(dead_code)]
        pub(crate) fn retain<T>(
            &self,
            _engine: &str,
            _sessions: &mut Vec<T>,
            _id_of: impl Fn(&T) -> &str,
        ) {
        }
    }
}

