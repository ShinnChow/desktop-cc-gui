// adapter and only uses the shared read-only V2 binding projection. It never pulls
// SharedEventWriter or the full Tauri command graph into the daemon crate.
#[allow(dead_code)]
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::app_paths;
use crate::engine::EngineType;
use crate::shared_binding_visibility::collect_v2_shared_binding_ids_by_session;

const SHARED_SESSIONS_DIRNAME: &str = "shared-sessions";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedSessionSummary {
    pub(crate) id: String,
    pub(crate) thread_id: String,
    pub(crate) title: String,
    pub(crate) created_at: u64,
    pub(crate) updated_at: u64,
    pub(crate) selected_engine: EngineType,
    pub(crate) thread_kind: String,
    pub(crate) engine_source: EngineType,
    pub(crate) selected_engine_label: String,
    pub(crate) native_thread_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedEngineBindingLite {
    native_thread_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedTargetBindingLite {
    #[serde(default)]
    native_thread_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedSessionMetaLite {
    id: String,
    title: String,
    #[serde(default)]
    created_at: u64,
    updated_at: u64,
    selected_engine: EngineType,
    #[serde(default)]
    bindings_by_engine: HashMap<EngineType, SharedEngineBindingLite>,
    #[serde(default)]
    bindings_by_target: HashMap<String, SharedTargetBindingLite>,
}

fn shared_sessions_root_dir() -> Result<PathBuf, String> {
    Ok(app_paths::app_home_dir()?.join(SHARED_SESSIONS_DIRNAME))
}

fn workspace_shared_sessions_dir(workspace_id: &str) -> Result<PathBuf, String> {
    Ok(shared_sessions_root_dir()?.join(workspace_id))
}

fn shared_session_dir(workspace_id: &str, shared_session_id: &str) -> Result<PathBuf, String> {
    Ok(workspace_shared_sessions_dir(workspace_id)?.join(shared_session_id))
}

fn shared_session_meta_path(
    workspace_id: &str,
    shared_session_id: &str,
) -> Result<PathBuf, String> {
    Ok(shared_session_dir(workspace_id, shared_session_id)?.join("meta.json"))
}

fn is_safe_shared_session_storage_id(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

fn parse_shared_session_id(thread_id: &str) -> Result<String, String> {
    let normalized = thread_id.trim();
    if let Some(rest) = normalized.strip_prefix("shared:") {
        let shared_session_id = rest.trim();
        if is_safe_shared_session_storage_id(shared_session_id) {
            return Ok(shared_session_id.to_string());
        }
    }
    Err(format!("Invalid shared session thread id: {thread_id}"))
}

fn shared_thread_id(shared_session_id: &str) -> String {
    format!("shared:{shared_session_id}")
}

fn read_shared_session_meta_lite(
    workspace_id: &str,
    shared_session_id: &str,
) -> Result<SharedSessionMetaLite, String> {
    let path = shared_session_meta_path(workspace_id, shared_session_id)?;
    let raw = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

/// 占位 desktop app 的 `SharedEventWriter` 参数槽。
/// daemon catalog 调用点始终传 `None`，并使用第三个参数提供的只读 V2
/// binding projection。
pub(crate) struct SharedEventWriter;

/// 保持 desktop signature，使 Shared Session Management 调用点 source-compatible，
/// 同时 daemon catalog 保持只读。
pub(crate) fn list_workspace_shared_sessions(
    workspace_id: &str,
    event_writer: Option<&SharedEventWriter>,
    event_log_path: Option<&Path>,
) -> Result<Vec<SharedSessionSummary>, String> {
    let directory = workspace_shared_sessions_dir(workspace_id)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut session_metas = Vec::new();
    for entry in std::fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if !file_type.is_dir() {
            continue;
        }
        let shared_session_id = entry.file_name().to_string_lossy().to_string();
        let meta = match read_shared_session_meta_lite(workspace_id, &shared_session_id) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        session_metas.push(meta);
    }

    let v2_native_thread_ids_by_session = if event_writer.is_none() {
        let shared_session_ids = session_metas
            .iter()
            .map(|meta| meta.id.clone())
            .collect::<Vec<_>>();
        match event_log_path {
            Some(path) => {
                match collect_v2_shared_binding_ids_by_session(path, &shared_session_ids) {
                    Ok(ids_by_session) => ids_by_session,
                    Err(error) => {
                        log::warn!(
                            "[cc_gui_daemon.shared_sessions] read-only V2 binding recovery failed for workspace {}: {}",
                            workspace_id,
                            error
                        );
                        BTreeMap::new()
                    }
                }
            }
            None => BTreeMap::new(),
        }
    } else {
        BTreeMap::new()
    };

    let mut summaries = Vec::with_capacity(session_metas.len());
    for meta in session_metas {
        let mut native_thread_ids = meta
            .bindings_by_engine
            .values()
            .map(|binding| binding.native_thread_id.clone())
            .collect::<Vec<_>>();
        native_thread_ids.extend(
            meta.bindings_by_target
                .values()
                .map(|binding| binding.native_thread_id.clone())
                .filter(|native_thread_id| !native_thread_id.trim().is_empty()),
        );
        if let Some(v2_native_thread_ids) = v2_native_thread_ids_by_session.get(&meta.id) {
            native_thread_ids.extend(v2_native_thread_ids.iter().cloned());
        }
        native_thread_ids.sort();
        native_thread_ids.dedup();
        summaries.push(SharedSessionSummary {
            id: meta.id.clone(),
            thread_id: shared_thread_id(&meta.id),
            title: meta.title.clone(),
            created_at: if meta.created_at > 0 {
                meta.created_at
            } else {
                meta.updated_at
            },
            updated_at: meta.updated_at,
            selected_engine: meta.selected_engine,
            thread_kind: "shared".to_string(),
            engine_source: meta.selected_engine,
            selected_engine_label: meta.selected_engine.display_name().to_string(),
            native_thread_ids,
        });
    }
    summaries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(summaries)
}

/// Returns `Ok(true)` when files were removed, `Ok(false)` when already absent.
pub(crate) fn delete_shared_session_files(
    workspace_id: &str,
    thread_id: &str,
) -> Result<bool, String> {
    let shared_session_id = parse_shared_session_id(thread_id)?;
    let path = shared_session_dir(workspace_id, &shared_session_id)?;
    if !path.exists() {
        return Ok(false);
    }
    std::fs::remove_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(true)
}

