use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use super::ledger::write_json_atomically;

const REGISTRY_FILE_NAME: &str = "executable-session-registry.json";
const DEFAULT_COMPACTION_THRESHOLD: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecutableSessionEntry {
    pub(crate) logical_session_id: String,
    pub(crate) engine: String,
    pub(crate) adapter_id: String,
    pub(crate) native_binding: Option<String>,
    pub(crate) runtime_generation: String,
    pub(crate) state: ExecutableSessionState,
    pub(crate) cursor: u64,
    pub(crate) last_settled_run_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ExecutableSessionState {
    Acquiring,
    Active,
    Stopping,
    Recoverable,
    Settled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutableSessionTransition {
    cursor: u64,
    logical_session_id: String,
    action: String,
    runtime_generation: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct DurableExecutableRegistry {
    entries: BTreeMap<String, ExecutableSessionEntry>,
    transitions: Vec<ExecutableSessionTransition>,
    cursor: u64,
    settled_run_ids: BTreeSet<String>,
}

#[derive(Debug)]
pub(crate) struct ExecutableSessionRegistry {
    durable_path: PathBuf,
    control_lane: Mutex<()>,
    state: Mutex<DurableExecutableRegistry>,
    compaction_threshold: usize,
}

impl ExecutableSessionRegistry {
    pub(crate) fn recover(data_dir: &Path) -> Self {
        let durable_path = data_dir.join(REGISTRY_FILE_NAME);
        let mut state: DurableExecutableRegistry = fs::read_to_string(&durable_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let interrupted_sessions = state
            .entries
            .iter()
            .filter(|&(_session_id, entry)| {
                matches!(
                    entry.state,
                    ExecutableSessionState::Acquiring
                        | ExecutableSessionState::Active
                        | ExecutableSessionState::Stopping
                )
            })
            .map(|(session_id, _entry)| session_id.clone())
            .collect::<Vec<_>>();
        let recovered_interrupted_state = !interrupted_sessions.is_empty();
        for session_id in interrupted_sessions {
            state.cursor = state.cursor.saturating_add(1);
            let cursor = state.cursor;
            if let Some(entry) = state.entries.get_mut(&session_id) {
                entry.state = ExecutableSessionState::Recoverable;
                entry.cursor = cursor;
                state.transitions.push(ExecutableSessionTransition {
                    cursor,
                    logical_session_id: session_id,
                    action: "recover-interrupted".to_string(),
                    runtime_generation: entry.runtime_generation.clone(),
                });
            }
        }
        if recovered_interrupted_state {
            match serde_json::to_string_pretty(&state)
                .map_err(|error| error.to_string())
                .and_then(|payload| write_json_atomically(&durable_path, &payload))
            {
                Ok(()) => {}
                Err(error) => log::warn!(
                    "[executable-session-registry] operation=recover-interrupted error={}",
                    error
                ),
            }
        }
        Self {
            durable_path,
            control_lane: Mutex::new(()),
            state: Mutex::new(state),
            compaction_threshold: DEFAULT_COMPACTION_THRESHOLD,
        }
    }

    #[cfg(test)]
    fn with_compaction_threshold(data_dir: &Path, compaction_threshold: usize) -> Self {
        let mut registry = Self::recover(data_dir);
        registry.compaction_threshold = compaction_threshold.max(1);
        registry
    }

    pub(crate) async fn register_or_rebind(
        &self,
        logical_session_id: &str,
        engine: &str,
        adapter_id: &str,
        native_binding: Option<&str>,
        runtime_generation: &str,
        state: ExecutableSessionState,
        expected_generation: Option<&str>,
    ) -> Result<ExecutableSessionEntry, String> {
        let logical_session_id = require_value(logical_session_id, "logical session id")?;
        let runtime_generation = require_value(runtime_generation, "runtime generation")?;
        let _control = self.control_lane.lock().await;
        let mut durable = self.state.lock().await;
        if let Some(expected_generation) = expected_generation {
            let current_generation = durable
                .entries
                .get(&logical_session_id)
                .map(|entry| entry.runtime_generation.as_str());
            if current_generation != Some(expected_generation) {
                return Err(format!(
                    "stale runtime generation for {logical_session_id}: expected {expected_generation}, current {}",
                    current_generation.unwrap_or("missing")
                ));
            }
        }
        durable.cursor = durable.cursor.saturating_add(1);
        let cursor = durable.cursor;
        let entry = ExecutableSessionEntry {
            logical_session_id: logical_session_id.clone(),
            engine: require_value(engine, "engine")?,
            adapter_id: require_value(adapter_id, "adapter id")?,
            native_binding: native_binding
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            runtime_generation: runtime_generation.clone(),
            state,
            cursor,
            last_settled_run_id: durable
                .entries
                .get(&logical_session_id)
                .and_then(|current| current.last_settled_run_id.clone()),
        };
        let action = if durable.entries.contains_key(&logical_session_id) {
            "rebind"
        } else {
            "register"
        };
        durable
            .entries
            .insert(logical_session_id.clone(), entry.clone());
        durable.transitions.push(ExecutableSessionTransition {
            cursor,
            logical_session_id,
            action: action.to_string(),
            runtime_generation,
        });
        self.compact_and_persist(&mut durable)?;
        Ok(entry)
    }

    pub(crate) async fn resolve(
        &self,
        logical_session_id: &str,
        expected_generation: Option<&str>,
    ) -> Result<Option<ExecutableSessionEntry>, String> {
        let durable = self.state.lock().await;
        let entry = durable.entries.get(logical_session_id).cloned();
        if let (Some(entry), Some(expected_generation)) = (&entry, expected_generation) {
            if entry.runtime_generation != expected_generation {
                return Err(format!(
                    "stale runtime generation for {logical_session_id}: expected {expected_generation}, current {}",
                    entry.runtime_generation
                ));
            }
        }
        Ok(entry)
    }

    pub(crate) async fn transition(
        &self,
        logical_session_id: &str,
        expected_generation: &str,
        next_state: ExecutableSessionState,
    ) -> Result<ExecutableSessionEntry, String> {
        let _control = self.control_lane.lock().await;
        let mut durable = self.state.lock().await;
        let current = durable
            .entries
            .get(logical_session_id)
            .cloned()
            .ok_or_else(|| format!("executable session not found: {logical_session_id}"))?;
        if current.runtime_generation != expected_generation {
            return Err(format!(
                "stale runtime generation for {logical_session_id}: expected {expected_generation}, current {}",
                current.runtime_generation
            ));
        }
        durable.cursor = durable.cursor.saturating_add(1);
        let cursor = durable.cursor;
        let mut next = current;
        next.state = next_state;
        next.cursor = cursor;
        durable
            .entries
            .insert(logical_session_id.to_string(), next.clone());
        durable.transitions.push(ExecutableSessionTransition {
            cursor,
            logical_session_id: logical_session_id.to_string(),
            action: "transition".to_string(),
            runtime_generation: expected_generation.to_string(),
        });
        self.compact_and_persist(&mut durable)?;
        Ok(next)
    }

    pub(crate) async fn mark_settled(
        &self,
        logical_session_id: &str,
        expected_generation: &str,
        run_id: &str,
    ) -> Result<bool, String> {
        let run_id = require_value(run_id, "run id")?;
        let _control = self.control_lane.lock().await;
        let mut durable = self.state.lock().await;
        if durable.settled_run_ids.contains(&run_id) {
            return Ok(false);
        }
        let current = durable
            .entries
            .get(logical_session_id)
            .cloned()
            .ok_or_else(|| format!("executable session not found: {logical_session_id}"))?;
        if current.runtime_generation != expected_generation {
            return Err(format!(
                "stale runtime generation for {logical_session_id}: expected {expected_generation}, current {}",
                current.runtime_generation
            ));
        }
        durable.cursor = durable.cursor.saturating_add(1);
        let cursor = durable.cursor;
        let mut next = current;
        next.state = ExecutableSessionState::Settled;
        next.cursor = cursor;
        next.last_settled_run_id = Some(run_id.clone());
        durable.settled_run_ids.insert(run_id);
        durable.entries.insert(logical_session_id.to_string(), next);
        durable.transitions.push(ExecutableSessionTransition {
            cursor,
            logical_session_id: logical_session_id.to_string(),
            action: "settled".to_string(),
            runtime_generation: expected_generation.to_string(),
        });
        self.compact_and_persist(&mut durable)?;
        Ok(true)
    }

    pub(crate) async fn release(
        &self,
        logical_session_id: &str,
        expected_generation: &str,
    ) -> Result<bool, String> {
        let _control = self.control_lane.lock().await;
        let mut durable = self.state.lock().await;
        let Some(current) = durable.entries.get(logical_session_id) else {
            return Ok(false);
        };
        if current.runtime_generation != expected_generation {
            return Err(format!(
                "stale runtime generation for {logical_session_id}: expected {expected_generation}, current {}",
                current.runtime_generation
            ));
        }
        durable.cursor = durable.cursor.saturating_add(1);
        let cursor = durable.cursor;
        durable.entries.remove(logical_session_id);
        durable.transitions.push(ExecutableSessionTransition {
            cursor,
            logical_session_id: logical_session_id.to_string(),
            action: "release".to_string(),
            runtime_generation: expected_generation.to_string(),
        });
        self.compact_and_persist(&mut durable)?;
        Ok(true)
    }

    fn compact_and_persist(&self, durable: &mut DurableExecutableRegistry) -> Result<(), String> {
        if durable.transitions.len() > self.compaction_threshold {
            let checkpoint_cursor = durable.cursor;
            durable.transitions = durable
                .entries
                .values()
                .map(|entry| ExecutableSessionTransition {
                    cursor: checkpoint_cursor,
                    logical_session_id: entry.logical_session_id.clone(),
                    action: "checkpoint".to_string(),
                    runtime_generation: entry.runtime_generation.clone(),
                })
                .collect();
        }
        let payload = serde_json::to_string_pretty(durable).map_err(|error| error.to_string())?;
        write_json_atomically(&self.durable_path, &payload)
    }
}

fn require_value(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} is required"));
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("mossx-{label}-{}", uuid::Uuid::new_v4()))
    }

    #[tokio::test]
    async fn stale_generation_cannot_control_rebound_session() {
        let data_dir = temp_dir("registry-stale");
        let registry = ExecutableSessionRegistry::recover(&data_dir);
        registry
            .register_or_rebind(
                "session-1",
                "codex",
                "codex-app-server",
                Some("native-1"),
                "generation-1",
                ExecutableSessionState::Active,
                None,
            )
            .await
            .unwrap();
        registry
            .register_or_rebind(
                "session-1",
                "codex",
                "codex-app-server",
                Some("native-2"),
                "generation-2",
                ExecutableSessionState::Active,
                Some("generation-1"),
            )
            .await
            .unwrap();

        assert!(registry
            .transition(
                "session-1",
                "generation-1",
                ExecutableSessionState::Stopping,
            )
            .await
            .unwrap_err()
            .contains("stale runtime generation"));
        let _ = fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn recovery_and_compaction_preserve_settlement_idempotency() {
        let data_dir = temp_dir("registry-replay");
        let registry = ExecutableSessionRegistry::with_compaction_threshold(&data_dir, 2);
        registry
            .register_or_rebind(
                "session-1",
                "kimi",
                "kimi-cli",
                Some("native-1"),
                "generation-1",
                ExecutableSessionState::Active,
                None,
            )
            .await
            .unwrap();
        assert!(registry
            .mark_settled("session-1", "generation-1", "run-1")
            .await
            .unwrap());
        registry
            .transition(
                "session-1",
                "generation-1",
                ExecutableSessionState::Recoverable,
            )
            .await
            .unwrap();

        let recovered = ExecutableSessionRegistry::recover(&data_dir);
        assert!(!recovered
            .mark_settled("session-1", "generation-1", "run-1")
            .await
            .unwrap());
        assert_eq!(
            recovered
                .resolve("session-1", Some("generation-1"))
                .await
                .unwrap()
                .unwrap()
                .state,
            ExecutableSessionState::Recoverable,
        );
        let _ = fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn restart_converges_interrupted_active_session_to_recoverable() {
        let data_dir = temp_dir("registry-interrupted");
        let registry = ExecutableSessionRegistry::recover(&data_dir);
        registry
            .register_or_rebind(
                "session-1",
                "codex",
                "builtin.codex",
                Some("native-1"),
                "generation-1",
                ExecutableSessionState::Active,
                None,
            )
            .await
            .unwrap();

        let recovered = ExecutableSessionRegistry::recover(&data_dir);
        assert_eq!(
            recovered
                .resolve("session-1", Some("generation-1"))
                .await
                .unwrap()
                .unwrap()
                .state,
            ExecutableSessionState::Recoverable,
        );
        let _ = fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn serial_control_lane_completes_without_event_lane_self_wait() {
        let data_dir = temp_dir("registry-control");
        let registry = std::sync::Arc::new(ExecutableSessionRegistry::recover(&data_dir));
        registry
            .register_or_rebind(
                "session-1",
                "codex",
                "codex-app-server",
                None,
                "generation-1",
                ExecutableSessionState::Active,
                None,
            )
            .await
            .unwrap();

        let queued_control = {
            let registry = registry.clone();
            tokio::spawn(async move {
                registry
                    .mark_settled("session-1", "generation-1", "run-1")
                    .await
            })
        };
        assert!(queued_control.await.unwrap().unwrap());
        let _ = fs::remove_dir_all(data_dir);
    }
}
