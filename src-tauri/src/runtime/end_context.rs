use std::collections::BTreeSet;

#[derive(Debug, Clone, Default)]
pub(super) struct RecentRuntimeEndContext {
    pub(super) affected_thread_ids: BTreeSet<String>,
    pub(super) affected_turn_ids: BTreeSet<String>,
    pub(super) affected_active_turns: BTreeSet<(String, String)>,
    pub(super) observed_at_ms: u64,
    pub(super) reason_code: String,
}

impl RecentRuntimeEndContext {
    pub(super) fn matches_reconciliation_query(&self, thread_id: &str, turn_id: Option<&str>) -> bool {
        let thread_id = thread_id.trim();
        if thread_id.is_empty() {
            return false;
        }
        if let Some(turn_id) = turn_id.map(str::trim).filter(|value| !value.is_empty()) {
            if self
                .affected_active_turns
                .contains(&(thread_id.to_string(), turn_id.to_string()))
            {
                return true;
            }
            return self.affected_thread_ids.contains(thread_id)
                && self.affected_turn_ids.contains(turn_id);
        }
        self.affected_thread_ids.contains(thread_id)
    }
}
