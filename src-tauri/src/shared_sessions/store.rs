use std::collections::{BTreeMap, HashMap};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::app_paths;
use crate::engine::EngineType;
use crate::shared_binding_visibility::collect_v2_shared_binding_ids_by_session;

use super::selection::{
    sanitize_shared_session_meta, SharedEngineBinding, SharedSelectedTarget,
    SharedTargetBindingMeta,
};
use super::thread_id::{canonical_shared_native_thread_id, parse_shared_session_id, shared_thread_id};

const SHARED_SESSIONS_DIRNAME: &str = "shared-sessions";
const SHARED_STORE_LOCK_WAIT_TIMEOUT: Duration = Duration::from_secs(5);
const SHARED_STORE_LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(25);
const SHARED_STORE_LOCK_STALE_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const SHARED_SESSION_SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedSessionMeta {
    #[serde(default = "default_shared_session_schema_version")]
    pub(crate) schema_version: u32,
    pub(crate) id: String,
    pub(crate) workspace_id: String,
    pub(crate) title: String,
    pub(crate) created_at: u64,
    pub(crate) updated_at: u64,
    /// V0 字段：保留写（= `selected_target.engine`），供回滚与旧版本读取。
    pub(crate) selected_engine: EngineType,
    /// Wave 4 起持久化；旧 meta 缺失时由 sanitize 从 `selected_engine` 迁移。
    #[serde(default)]
    pub(crate) selected_target: Option<SharedSelectedTarget>,
    pub(crate) last_turn_seq: u64,
    pub(crate) bindings_by_engine: HashMap<EngineType, SharedEngineBinding>,
    /// Wave 4 起持久化；旧 meta 缺失时由 sanitize 从 `bindings_by_engine` 迁移。
    #[serde(default)]
    pub(crate) bindings_by_target: HashMap<String, SharedTargetBindingMeta>,
}

fn default_shared_session_schema_version() -> u32 {
    SHARED_SESSION_SCHEMA_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedSessionSnapshotEntry {
    pub(crate) kind: String,
    pub(crate) created_at: u64,
    pub(crate) selected_engine: EngineType,
    pub(crate) last_turn_seq: u64,
    pub(crate) items: Vec<Value>,
}

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

struct SharedStoreFileLock {
    path: PathBuf,
}

impl Drop for SharedStoreFileLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn shared_store_lock_file_path(path: &Path) -> PathBuf {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!("{value}.lock"))
        .unwrap_or_else(|| "lock".to_string());
    path.with_extension(extension)
}

fn is_shared_store_lock_stale(lock_path: &Path) -> bool {
    let metadata = match std::fs::metadata(lock_path) {
        Ok(metadata) => metadata,
        Err(_) => return false,
    };
    let modified_at = match metadata.modified() {
        Ok(modified_at) => modified_at,
        Err(_) => return false,
    };
    match modified_at.elapsed() {
        Ok(elapsed) => elapsed > SHARED_STORE_LOCK_STALE_TIMEOUT,
        Err(_) => false,
    }
}

fn acquire_shared_store_lock(path: &Path) -> Result<SharedStoreFileLock, String> {
    let lock_path = shared_store_lock_file_path(path);
    if let Some(parent) = lock_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let deadline = Instant::now() + SHARED_STORE_LOCK_WAIT_TIMEOUT;
    loop {
        match std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&lock_path)
        {
            Ok(mut file) => {
                let _ = writeln!(file, "pid={}", std::process::id());
                return Ok(SharedStoreFileLock { path: lock_path });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if is_shared_store_lock_stale(&lock_path) {
                    let _ = std::fs::remove_file(&lock_path);
                    continue;
                }
                if Instant::now() >= deadline {
                    return Err(format!(
                        "Timed out waiting for shared session file lock: {}",
                        lock_path.display()
                    ));
                }
                thread::sleep(SHARED_STORE_LOCK_RETRY_INTERVAL);
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

pub(crate) fn with_shared_store_lock<T>(
    path: &Path,
    op: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _lock_guard = acquire_shared_store_lock(path)?;
    op()
}

pub(crate) fn write_string_atomically(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("Shared session path has no parent: {}", path.display()))?;
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            format!(
                "Shared session path has invalid filename: {}",
                path.display()
            )
        })?;
    let temp_path = parent.join(format!(".{filename}.{}.tmp", Uuid::new_v4()));
    let mut temp_file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| error.to_string())?;
    temp_file
        .write_all(content.as_bytes())
        .map_err(|error| error.to_string())?;
    temp_file.sync_all().map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    if path.exists() {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }

    if let Err(error) = std::fs::rename(&temp_path, path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error.to_string());
    }
    Ok(())
}

pub(crate) fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

fn shared_sessions_root_dir() -> Result<PathBuf, String> {
    Ok(app_paths::app_home_dir()?.join(SHARED_SESSIONS_DIRNAME))
}

fn workspace_shared_sessions_dir(workspace_id: &str) -> Result<PathBuf, String> {
    Ok(shared_sessions_root_dir()?.join(workspace_id))
}

pub(crate) fn shared_session_dir(workspace_id: &str, shared_session_id: &str) -> Result<PathBuf, String> {
    Ok(workspace_shared_sessions_dir(workspace_id)?.join(shared_session_id))
}

pub(crate) fn shared_session_meta_path(
    workspace_id: &str,
    shared_session_id: &str,
) -> Result<PathBuf, String> {
    Ok(shared_session_dir(workspace_id, shared_session_id)?.join("meta.json"))
}

fn shared_session_log_path(workspace_id: &str, shared_session_id: &str) -> Result<PathBuf, String> {
    Ok(shared_session_dir(workspace_id, shared_session_id)?.join("log.jsonl"))
}

pub(crate) fn shared_session_projection_source(
    workspace_id: &str,
    thread_id: &str,
) -> Result<(String, PathBuf), String> {
    let shared_session_id = parse_shared_session_id(thread_id)?;
    let log_path = shared_session_log_path(workspace_id, &shared_session_id)?;
    Ok((shared_session_id, log_path))
}

pub(crate) fn read_shared_session_meta(
    workspace_id: &str,
    shared_session_id: &str,
) -> Result<SharedSessionMeta, String> {
    let path = shared_session_meta_path(workspace_id, shared_session_id)?;
    let raw = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut meta: SharedSessionMeta =
        serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    sanitize_shared_session_meta(&mut meta);
    Ok(meta)
}

/// Filesystem-only Shared ownership seed (V0 metadata). Does not touch EventWriter.
#[derive(Debug, Clone, Default)]
pub(crate) struct WorkspaceSharedOwnershipSeed {
    pub session_ids: Vec<String>,
    pub native_ids: Vec<String>,
    pub skipped_meta: usize,
}

pub(crate) fn load_workspace_shared_ownership_seed(
    workspace_id: &str,
) -> Result<WorkspaceSharedOwnershipSeed, String> {
    let directory = workspace_shared_sessions_dir(workspace_id)?;
    if !directory.exists() {
        return Ok(WorkspaceSharedOwnershipSeed::default());
    }
    load_seed_from_shared_sessions_dir(&directory)
}

/// Iterate one `shared-sessions/<workspace_id>` directory. Split out for
/// tests (temp dir) — behavior must stay identical to reading via
/// workspace_id paths.
pub(crate) fn load_seed_from_shared_sessions_dir(
    directory: &std::path::Path,
) -> Result<WorkspaceSharedOwnershipSeed, String> {
    let mut seed = WorkspaceSharedOwnershipSeed::default();
    for entry in std::fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if !file_type.is_dir() {
            continue;
        }
        let shared_session_id = entry.file_name().to_string_lossy().to_string();
        if shared_session_id.trim().is_empty() {
            continue;
        }
        let meta_path = entry.path().join("meta.json");
        // meta.json 整个缺失（崩溃/中断创建的残留空目录）不是真实 session，
        // 静默跳过；只有 meta.json 存在但读不出/解析失败才按保守策略记
        // skipped_meta（→ projection unavailable，前端 defer 全部 native
        // 行直到 hide 验证）。此前残留空目录会让 skipped_meta>0 →
        // visibility 恒 unavailable → 侧栏 first-paint early paint 全部
        // 被 defer，首段必空（2026-08-26 实证：7 个 workspace 42 个残留
        // 空目录，reason=legacy-meta-skipped:N）。
        if !meta_path.exists() {
            continue;
        }
        let meta = std::fs::read_to_string(&meta_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<SharedSessionMeta>(&raw).ok());
        let Some(mut meta) = meta else {
            seed.skipped_meta += 1;
            continue;
        };
        sanitize_shared_session_meta(&mut meta);
        seed.session_ids.push(meta.id.clone());
        for (engine, binding) in &meta.bindings_by_engine {
            let native_id =
                canonical_shared_native_thread_id(*engine, None, &binding.native_thread_id);
            let native_id = native_id.trim();
            if !native_id.is_empty() {
                seed.native_ids.push(native_id.to_string());
            }
        }
        for binding in meta.bindings_by_target.values() {
            let native_id = canonical_shared_native_thread_id(
                binding.engine,
                binding.provider_profile_id.as_deref(),
                &binding.native_thread_id,
            );
            let native_id = native_id.trim();
            if !native_id.is_empty() {
                seed.native_ids.push(native_id.to_string());
            }
        }
    }
    seed.session_ids.sort();
    seed.session_ids.dedup();
    seed.native_ids.sort();
    seed.native_ids.dedup();
    Ok(seed)
}

pub(crate) fn write_shared_session_meta(meta: &SharedSessionMeta) -> Result<(), String> {
    let path = shared_session_meta_path(&meta.workspace_id, &meta.id)?;
    with_shared_store_lock(&path, || {
        let mut sanitized = meta.clone();
        sanitize_shared_session_meta(&mut sanitized);
        let raw = serde_json::to_string_pretty(&sanitized).map_err(|error| error.to_string())?;
        write_string_atomically(&path, &raw)
    })
}

pub(crate) fn append_shared_session_log_entry(
    workspace_id: &str,
    shared_session_id: &str,
    entry: &SharedSessionSnapshotEntry,
) -> Result<(), String> {
    let path = shared_session_log_path(workspace_id, shared_session_id)?;
    with_shared_store_lock(&path, || {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let serialized = serde_json::to_string(entry).map_err(|error| error.to_string())?;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|error| error.to_string())?;
        writeln!(file, "{serialized}").map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        Ok(())
    })
}

pub(crate) fn read_latest_shared_session_snapshot(
    workspace_id: &str,
    shared_session_id: &str,
) -> Result<Option<SharedSessionSnapshotEntry>, String> {
    let path = shared_session_log_path(workspace_id, shared_session_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let latest = content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<SharedSessionSnapshotEntry>(line).ok())
        .last();
    Ok(latest)
}

pub(crate) fn list_workspace_shared_sessions(
    workspace_id: &str,
    event_writer: Option<&crate::shared_event_log::SharedEventWriter>,
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
        let meta = match read_shared_session_meta(workspace_id, &shared_session_id) {
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
            Some(path) => match collect_v2_shared_binding_ids_by_session(path, &shared_session_ids)
            {
                Ok(ids_by_session) => ids_by_session,
                Err(error) => {
                    log::warn!(
                        "[shared_sessions.list_workspace_shared_sessions] read-only V2 binding recovery failed for workspace {}: {}",
                        workspace_id,
                        error
                    );
                    BTreeMap::new()
                }
            },
            None => BTreeMap::new(),
        }
    } else {
        BTreeMap::new()
    };

    let mut summaries = Vec::with_capacity(session_metas.len());
    for meta in session_metas {
        let mut native_thread_ids = meta
            .bindings_by_engine
            .iter()
            .map(|(engine, binding)| {
                canonical_shared_native_thread_id(*engine, None, &binding.native_thread_id)
            })
            .collect::<Vec<_>>();
        native_thread_ids.extend(meta.bindings_by_target.values().map(|binding| {
            canonical_shared_native_thread_id(
                binding.engine,
                binding.provider_profile_id.as_deref(),
                &binding.native_thread_id,
            )
        }));
        if let Some(writer) = event_writer {
            native_thread_ids.extend(
                writer
                    .binding_states_for_session(&meta.id)
                    .map_err(|error| error.to_string())?
                    .into_iter()
                    .filter_map(|binding| {
                        binding.native_session_id.map(|native_session_id| {
                            if binding.engine == EngineType::Qoder.icon() {
                                canonical_shared_native_thread_id(
                                    EngineType::Qoder,
                                    binding.provider_profile_id.as_deref(),
                                    &native_session_id,
                                )
                            } else {
                                native_session_id
                            }
                        })
                    })
                    .filter(|native_session_id| !native_session_id.trim().is_empty()),
            );
        } else if let Some(v2_native_thread_ids) = v2_native_thread_ids_by_session.get(&meta.id) {
            native_thread_ids.extend(v2_native_thread_ids.iter().cloned());
        }
        native_thread_ids.sort();
        native_thread_ids.dedup();
        summaries.push(SharedSessionSummary {
            id: meta.id.clone(),
            thread_id: shared_thread_id(&meta.id),
            title: meta.title.clone(),
            created_at: meta.created_at,
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
