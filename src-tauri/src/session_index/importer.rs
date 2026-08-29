use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::commands::{backfill_session_index_core, sync_session_index_core};
use crate::state::AppState;

pub(crate) const SESSION_INDEX_IMPORTED_EVENT: &str = "session-index-imported";
pub(crate) const IMPORT_INTERVAL: Duration = Duration::from_secs(90);
/// Startup-safe delay: long enough to miss first-click freeze, short enough
/// that upgrade/cold-start does not sit idle for 45s before the first scan.
/// 首扫成本已由 list_pi_sessions 有界化（cwd 预过滤 + 64KB/file）压到亚秒级，
/// 3s 首 tick 不再构成启动风暴源（2026-08-29 复核后维持原契约）。
pub(crate) const IMPORT_INITIAL_DELAY: Duration = Duration::from_secs(3);
const IMPORT_LIMIT: usize = 50;

pub(crate) struct ImportTickSchedule {
    first_tick: AtomicBool,
}

impl ImportTickSchedule {
    pub(crate) fn new() -> Self {
        Self {
            first_tick: AtomicBool::new(true),
        }
    }

    /// First tick is force; later ticks stay freshness-gated.
    pub(crate) fn take_force_sync(&self) -> bool {
        self.first_tick.swap(false, Ordering::AcqRel)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionIndexImportedPayload {
    pub workspace_ids: Vec<String>,
    pub upserted: u32,
}

pub(crate) struct ImportTickGuard {
    in_flight: AtomicBool,
}

impl ImportTickGuard {
    pub(crate) fn new() -> Self {
        Self {
            in_flight: AtomicBool::new(false),
        }
    }

    pub(crate) fn try_begin(&self) -> bool {
        self.in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub(crate) fn end(&self) {
        self.in_flight.store(false, Ordering::Release);
    }
}

pub(crate) fn spawn_session_index_importer(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(IMPORT_INITIAL_DELAY).await;
        let guard = std::sync::Arc::new(ImportTickGuard::new());
        let schedule = ImportTickSchedule::new();
        loop {
            {
                let state = app.state::<AppState>();
                if state.runtime_manager.is_shutting_down() {
                    break;
                }
            }
            if guard.try_begin() {
                let tick_guard = guard.clone();
                let app_handle = app.clone();
                let force_sync = schedule.take_force_sync();
                let result = run_import_tick(&app_handle, force_sync).await;
                tick_guard.end();
                if let Ok(payload) = result {
                    if payload.upserted > 0 {
                        let _ = app_handle.emit(SESSION_INDEX_IMPORTED_EVENT, payload);
                    }
                }
            }
            tokio::time::sleep(IMPORT_INTERVAL).await;
        }
    });
}

async fn run_import_tick(
    app: &AppHandle,
    force_sync: bool,
) -> Result<SessionIndexImportedPayload, String> {
    let state = app.state::<AppState>();
    let mut targets: Vec<(String, String)> = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .iter()
            .filter_map(|(id, entry)| {
                let path = entry.path.trim();
                if path.is_empty() {
                    None
                } else {
                    Some((id.clone(), path.to_string()))
                }
            })
            .collect()
    };
    targets.sort_by(|left, right| left.0.cmp(&right.0));

    let mut upserted = 0u32;
    let mut changed_ids = Vec::new();
    for (workspace_id, _path) in targets {
        let mut workspace_upserted = 0usize;
        match sync_session_index_core(&state, &workspace_id, IMPORT_LIMIT, force_sync).await {
            Ok(report) => {
                workspace_upserted = workspace_upserted.saturating_add(report.upserted);
            }
            Err(error) => {
                log::debug!("session-index import skipped {workspace_id}: {error}");
            }
        }
        match backfill_session_index_core(&state, &workspace_id).await {
            Ok(report) => {
                workspace_upserted = workspace_upserted.saturating_add(report.upserted);
            }
            Err(error) => {
                log::debug!("session-index backfill skipped {workspace_id}: {error}");
            }
        }
        if workspace_upserted > 0 {
            upserted = upserted.saturating_add(workspace_upserted as u32);
            changed_ids.push(workspace_id);
        }
    }
    Ok(SessionIndexImportedPayload {
        workspace_ids: changed_ids,
        upserted,
    })
}

#[cfg(test)]
mod tests {
    use super::{ImportTickGuard, ImportTickSchedule, IMPORT_INITIAL_DELAY, IMPORT_INTERVAL};
    use std::time::Duration;

    #[test]
    fn overlapping_tick_is_rejected() {
        let guard = ImportTickGuard::new();
        assert!(guard.try_begin());
        assert!(!guard.try_begin());
        guard.end();
        assert!(guard.try_begin());
    }

    #[test]
    fn first_tick_is_forced_later_ticks_use_freshness() {
        let schedule = ImportTickSchedule::new();
        assert!(schedule.take_force_sync(), "first tick must force sync");
        assert!(
            !schedule.take_force_sync(),
            "second tick must stay freshness-gated"
        );
        assert!(!schedule.take_force_sync(), "later ticks stay force=false");
    }

    #[test]
    fn initial_delay_is_startup_safe_seconds_not_forty_five() {
        assert!(IMPORT_INITIAL_DELAY >= Duration::from_secs(2));
        assert!(IMPORT_INITIAL_DELAY <= Duration::from_secs(5));
        assert!(IMPORT_INITIAL_DELAY < IMPORT_INTERVAL);
        assert!(IMPORT_INTERVAL >= Duration::from_secs(90));
    }
}
