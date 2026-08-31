use std::collections::{BTreeSet, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::types::WorkspaceEntry;

use super::consts::RUNTIME_CHURN_WINDOW_MILLIS;
use super::identity::normalize_engine;
use super::pool_types::{
    RuntimeForegroundWorkState, RuntimeProcessDiagnostics, RuntimeStartupState,
};

pub(super) fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone)]
pub(super) struct RuntimeEntry {
    pub(super) workspace_id: String,
    pub(super) workspace_name: String,
    pub(super) workspace_path: String,
    pub(super) engine: String,
    pub(super) pid: Option<u32>,
    pub(super) wrapper_kind: Option<String>,
    pub(super) resolved_bin: Option<String>,
    pub(super) started_at_ms: Option<u64>,
    pub(super) last_used_at_ms: u64,
    pub(super) pinned: bool,
    pub(super) error: Option<String>,
    pub(super) session_exists: bool,
    pub(super) starting: bool,
    pub(super) stopping: bool,
    pub(super) zombie_suspected: bool,
    pub(super) turn_leases: BTreeSet<String>,
    pub(super) stream_leases: BTreeSet<String>,
    pub(super) active_work_since_ms: Option<u64>,
    pub(super) active_work_last_renewed_at_ms: Option<u64>,
    pub(super) foreground_work_state: Option<RuntimeForegroundWorkState>,
    pub(super) foreground_work_source: Option<String>,
    pub(super) foreground_work_thread_id: Option<String>,
    pub(super) foreground_work_turn_id: Option<String>,
    pub(super) foreground_work_since_ms: Option<u64>,
    pub(super) foreground_work_timeout_at_ms: Option<u64>,
    pub(super) foreground_work_last_event_at_ms: Option<u64>,
    pub(super) foreground_work_timed_out: bool,
    pub(super) evict_candidate: bool,
    pub(super) manual_release_requested: bool,
    pub(super) eviction_reason: Option<String>,
    pub(super) last_exit_reason_code: Option<String>,
    pub(super) last_exit_message: Option<String>,
    pub(super) last_exit_at_ms: Option<u64>,
    pub(super) last_exit_code: Option<i32>,
    pub(super) last_exit_signal: Option<String>,
    pub(super) last_exit_pending_request_count: u32,
    pub(super) process_diagnostics: Option<RuntimeProcessDiagnostics>,
    pub(super) startup_state: Option<RuntimeStartupState>,
    pub(super) last_recovery_source: Option<String>,
    pub(super) last_guard_state: Option<String>,
    pub(super) last_replace_reason: Option<String>,
    pub(super) last_probe_failure: Option<String>,
    pub(super) last_probe_failure_source: Option<String>,
    pub(super) has_stopping_predecessor: bool,
    pub(super) recent_spawn_events: VecDeque<u64>,
    pub(super) recent_replace_events: VecDeque<u64>,
    pub(super) recent_force_kill_events: VecDeque<u64>,
}

impl RuntimeEntry {
    pub(super) fn from_workspace(entry: &WorkspaceEntry, engine: &str) -> Self {
        Self {
            workspace_id: entry.id.clone(),
            workspace_name: entry.name.clone(),
            workspace_path: entry.path.clone(),
            engine: normalize_engine(engine),
            pid: None,
            wrapper_kind: None,
            resolved_bin: None,
            started_at_ms: None,
            last_used_at_ms: now_millis(),
            pinned: false,
            error: None,
            session_exists: false,
            starting: true,
            stopping: false,
            zombie_suspected: false,
            turn_leases: BTreeSet::new(),
            stream_leases: BTreeSet::new(),
            active_work_since_ms: None,
            active_work_last_renewed_at_ms: None,
            foreground_work_state: None,
            foreground_work_source: None,
            foreground_work_thread_id: None,
            foreground_work_turn_id: None,
            foreground_work_since_ms: None,
            foreground_work_timeout_at_ms: None,
            foreground_work_last_event_at_ms: None,
            foreground_work_timed_out: false,
            evict_candidate: false,
            manual_release_requested: false,
            eviction_reason: None,
            last_exit_reason_code: None,
            last_exit_message: None,
            last_exit_at_ms: None,
            last_exit_code: None,
            last_exit_signal: None,
            last_exit_pending_request_count: 0,
            process_diagnostics: None,
            startup_state: Some(RuntimeStartupState::Starting),
            last_recovery_source: None,
            last_guard_state: None,
            last_replace_reason: None,
            last_probe_failure: None,
            last_probe_failure_source: None,
            has_stopping_predecessor: false,
            recent_spawn_events: VecDeque::new(),
            recent_replace_events: VecDeque::new(),
            recent_force_kill_events: VecDeque::new(),
        }
    }

    pub(super) fn update_workspace(&mut self, entry: &WorkspaceEntry, engine: &str) {
        self.workspace_name = entry.name.clone();
        self.workspace_path = entry.path.clone();
        self.engine = normalize_engine(engine);
        self.last_used_at_ms = now_millis();
    }

    pub(super) fn lease_sources(&self) -> Vec<String> {
        self.turn_leases
            .iter()
            .chain(self.stream_leases.iter())
            .cloned()
            .collect()
    }

    pub(super) fn runtime_generation(&self) -> Option<String> {
        let started_at_ms = self.started_at_ms?;
        Some(match self.pid {
            Some(pid) => format!("pid:{pid}:startedAt:{started_at_ms}"),
            None => format!("pid:unknown:startedAt:{started_at_ms}"),
        })
    }

    pub(super) fn prune_recent_events(events: &mut VecDeque<u64>) {
        let cutoff = now_millis().saturating_sub(RUNTIME_CHURN_WINDOW_MILLIS);
        while matches!(events.front(), Some(timestamp) if *timestamp < cutoff) {
            events.pop_front();
        }
    }

    pub(super) fn record_recent_event(events: &mut VecDeque<u64>) {
        Self::prune_recent_events(events);
        events.push_back(now_millis());
    }

    pub(super) fn recent_event_count(events: &VecDeque<u64>) -> u32 {
        let cutoff = now_millis().saturating_sub(RUNTIME_CHURN_WINDOW_MILLIS);
        events
            .iter()
            .filter(|timestamp| **timestamp >= cutoff)
            .count() as u32
    }

    pub(super) fn record_spawn_event(&mut self) {
        Self::record_recent_event(&mut self.recent_spawn_events);
    }

    pub(super) fn record_replace_event(&mut self) {
        Self::record_recent_event(&mut self.recent_replace_events);
    }

    pub(super) fn record_force_kill_event(&mut self) {
        Self::record_recent_event(&mut self.recent_force_kill_events);
    }

    pub(super) fn recent_spawn_count(&self) -> u32 {
        Self::recent_event_count(&self.recent_spawn_events)
    }

    pub(super) fn recent_replace_count(&self) -> u32 {
        Self::recent_event_count(&self.recent_replace_events)
    }

    pub(super) fn recent_force_kill_count(&self) -> u32 {
        Self::recent_event_count(&self.recent_force_kill_events)
    }

    pub(super) fn has_active_leases(&self) -> bool {
        !self.turn_leases.is_empty() || !self.stream_leases.is_empty()
    }

    pub(super) fn has_foreground_work_continuity(&self) -> bool {
        self.foreground_work_state.is_some()
    }

    pub(super) fn has_active_work_protection(&self) -> bool {
        self.has_active_leases() || self.has_foreground_work_continuity()
    }

    pub(super) fn active_work_reason(&self) -> Option<String> {
        match (!self.turn_leases.is_empty(), !self.stream_leases.is_empty()) {
            (true, true) => Some("turn+stream".to_string()),
            (true, false) => Some("turn".to_string()),
            (false, true) => Some("stream".to_string()),
            (false, false) => self
                .foreground_work_state
                .as_ref()
                .map(|state| match state {
                    RuntimeForegroundWorkState::StartupPending => "startup-pending".to_string(),
                    RuntimeForegroundWorkState::ResumePending => "resume-pending".to_string(),
                }),
        }
    }

    pub(super) fn refresh_active_work_protection(&mut self) {
        if !self.has_active_leases() {
            self.active_work_since_ms = None;
            self.active_work_last_renewed_at_ms = None;
            return;
        }
        let now = now_millis();
        self.active_work_since_ms.get_or_insert(now);
        self.active_work_last_renewed_at_ms = Some(now);
        self.evict_candidate = false;
        if self.eviction_reason.as_deref() != Some("manual-release-waiting-for-active-work") {
            self.eviction_reason = None;
        }
    }

    pub(super) fn clear_active_work_protection_if_idle(&mut self) {
        if self.has_active_leases() {
            self.refresh_active_work_protection();
            return;
        }
        self.active_work_since_ms = None;
        self.active_work_last_renewed_at_ms = None;
    }

    pub(super) fn set_foreground_work_continuity(
        &mut self,
        state: RuntimeForegroundWorkState,
        thread_id: &str,
        turn_id: Option<&str>,
        source: &str,
        timeout_ms: u64,
    ) {
        let now = now_millis();
        self.foreground_work_state = Some(state);
        self.foreground_work_source = Some(source.to_string());
        self.foreground_work_thread_id = Some(thread_id.to_string());
        self.foreground_work_turn_id = turn_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        self.foreground_work_since_ms = Some(now);
        self.foreground_work_timeout_at_ms = Some(now.saturating_add(timeout_ms.max(1)));
        self.foreground_work_last_event_at_ms = Some(now);
        self.foreground_work_timed_out = false;
        self.evict_candidate = false;
        if self.eviction_reason.as_deref() != Some("manual-release-waiting-for-active-work") {
            self.eviction_reason = None;
        }
    }

    pub(super) fn clear_foreground_work_continuity(&mut self) {
        self.foreground_work_state = None;
        self.foreground_work_source = None;
        self.foreground_work_thread_id = None;
        self.foreground_work_turn_id = None;
        self.foreground_work_since_ms = None;
        self.foreground_work_timeout_at_ms = None;
        self.foreground_work_last_event_at_ms = None;
        self.foreground_work_timed_out = false;
    }

    pub(super) fn note_foreground_work_timeout(&mut self) {
        if self
            .foreground_work_timeout_at_ms
            .is_some_and(|timeout_at_ms| timeout_at_ms <= now_millis())
        {
            self.foreground_work_timed_out = true;
        }
    }

    pub(super) fn matches_foreground_work_identity(
        &self,
        thread_id: Option<&str>,
        turn_id: Option<&str>,
    ) -> bool {
        let Some(current_thread_id) = self.foreground_work_thread_id.as_deref() else {
            return false;
        };
        if let Some(candidate_thread_id) = thread_id {
            let normalized_thread_id = candidate_thread_id.trim();
            if !normalized_thread_id.is_empty() && normalized_thread_id != current_thread_id {
                return false;
            }
        }
        if let Some(expected_turn_id) = self.foreground_work_turn_id.as_deref() {
            if let Some(candidate_turn_id) = turn_id {
                let normalized_turn_id = candidate_turn_id.trim();
                if !normalized_turn_id.is_empty() && normalized_turn_id != expected_turn_id {
                    return false;
                }
            }
        }
        true
    }

    pub(super) fn matches_reconciliation_query(&self, thread_id: &str, turn_id: Option<&str>) -> bool {
        if self.matches_foreground_work_identity(Some(thread_id), turn_id) {
            return true;
        }

        let Some(turn_id) = turn_id.map(str::trim).filter(|value| !value.is_empty()) else {
            return false;
        };
        let turn_source = format!("turn:{turn_id}");
        let stream_source = format!("stream:{turn_id}");
        self.turn_leases.contains(&turn_source) || self.stream_leases.contains(&stream_source)
    }
}
