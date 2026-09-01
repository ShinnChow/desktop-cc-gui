use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use tokio::sync::Mutex;

use super::{
    apply_attribution_to_entry, build_catalog_entry_stable_key, parse_catalog_identity,
    resolve_catalog_entry_attribution, source_status_for_engine, AutoSessionMetadata,
    AutoSessionVisibility, CodexProviderBinding, EngineProviderBinding,
    ProviderContinuationMetadata, ProviderContinuationProjection, SessionCatalogAttributionConfidence,
    SessionCatalogAttributionReason, SessionCatalogAttributionStatus, SessionCatalogIdentity,
    WorkspaceSessionCatalogEntry, WorkspaceSessionCatalogMetadata, WorkspaceSessionCatalogSourceStatus,
    WorkspaceSessionFolder, WorkspaceSessionMutationTarget, WorkspaceSessionSourceCompleteness,
    SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID, SESSION_DELETE_MODE_METADATA_CLEANUP,
    SESSION_DELETE_MODE_PHYSICAL, SESSION_FOLDER_ROOT_ID, SESSION_FOLDER_SYSTEM_AUTO_ID,
    SESSION_INCONSISTENCY_MISSING_ON_DISK,
};
use crate::engine;
use crate::storage::{read_json_file, with_storage_lock, write_string_atomically};
use crate::types::WorkspaceEntry;

pub(crate) fn normalize_workspace_id(workspace_id: &str) -> Result<String, String> {
    let normalized = workspace_id.trim();
    if normalized.is_empty() {
        return Err("workspace_id is required".to_string());
    }
    Ok(normalized.to_string())
}

pub(crate) fn normalize_session_ids(session_ids: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for session_id in session_ids {
        let trimmed = session_id.trim();
        if trimmed.is_empty() {
            return Err("session_ids must not contain empty values".to_string());
        }
        if is_invalid_session_path_segment(trimmed) {
            return Err("invalid session_id".to_string());
        }
        if seen.insert(trimmed.to_string()) {
            normalized.push(trimmed.to_string());
        }
    }
    Ok(normalized)
}

pub(crate) fn normalize_folder_id(folder_id: &str) -> Result<String, String> {
    let normalized = folder_id.trim();
    if normalized.is_empty() {
        return Err("folder_id is required".to_string());
    }
    if normalized == SESSION_FOLDER_ROOT_ID
        || normalized == SESSION_FOLDER_SYSTEM_AUTO_ID
        || is_invalid_session_path_segment(normalized)
    {
        return Err("invalid folder_id".to_string());
    }
    Ok(normalized.to_string())
}

pub(crate) fn normalize_optional_folder_id(folder_id: Option<String>) -> Result<Option<String>, String> {
    match folder_id {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() || trimmed == SESSION_FOLDER_ROOT_ID {
                Ok(None)
            } else {
                Ok(Some(normalize_folder_id(trimmed)?))
            }
        }
        None => Ok(None),
    }
}

pub(crate) fn normalize_folder_name(name: &str) -> Result<String, String> {
    let normalized = name.trim();
    if normalized.is_empty() {
        return Err("folder name is required".to_string());
    }
    if normalized.len() > 120 {
        return Err("folder name is too long".to_string());
    }
    Ok(normalized.to_string())
}

pub(crate) fn is_invalid_session_path_segment(session_id: &str) -> bool {
    session_id == "."
        || session_id.contains('/')
        || session_id.contains('\\')
        || session_id.contains("..")
}

pub(crate) fn build_catalog_entry_dedupe_key(entry: &WorkspaceSessionCatalogEntry) -> String {
    format!(
        "{}::{}::{}",
        entry.engine, entry.workspace_id, entry.session_id
    )
}

pub(crate) fn mark_entry_as_existing_on_disk(entry: &mut WorkspaceSessionCatalogEntry) {
    entry.exists_on_disk = true;
    entry.inconsistency_code = None;
    entry.delete_mode = Some(SESSION_DELETE_MODE_PHYSICAL.to_string());
}

fn build_metadata_orphan_entry(
    workspace: &WorkspaceEntry,
    session_id: &str,
    archived_at: Option<i64>,
    folder_id: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
) -> WorkspaceSessionCatalogEntry {
    let identity = parse_catalog_identity(session_id);
    let folder_id = if auto_session
        .as_ref()
        .is_some_and(|metadata| metadata.visibility == AutoSessionVisibility::SystemAuto)
    {
        Some(SESSION_FOLDER_SYSTEM_AUTO_ID.to_string())
    } else {
        folder_id
    };
    WorkspaceSessionCatalogEntry {
        session_id: session_id.to_string(),
        stable_session_key: None,
        canonical_session_id: Some(session_id.to_string()),
        parent_session_id: None,
        workspace_id: workspace.id.clone(),
        workspace_label: Some(workspace.name.clone()),
        engine: identity.engine_name().to_string(),
        title: "Missing session".to_string(),
        native_title: None,
        updated_at: archived_at.unwrap_or(0).max(0),
        archived_at,
        thread_kind: "native".to_string(),
        source: None,
        source_label: None,
        provider_profile_id: None,
        provider_profile_source: None,
        provider_profile_name: None,
        provider_availability: None,
        source_completeness: None,
        source_status_reason: None,
        size_bytes: None,
        cwd: None,
        attribution_status: Some(
            SessionCatalogAttributionStatus::StrictMatch
                .as_str()
                .to_string(),
        ),
        attribution_reason: Some(
            SessionCatalogAttributionReason::SourceIncomplete
                .as_str()
                .to_string(),
        ),
        attribution_confidence: Some(
            SessionCatalogAttributionConfidence::Low
                .as_str()
                .to_string(),
        ),
        matched_workspace_id: Some(workspace.id.clone()),
        matched_workspace_label: Some(workspace.name.clone()),
        folder_id,
        auto_session,
        exists_on_disk: false,
        inconsistency_code: Some(SESSION_INCONSISTENCY_MISSING_ON_DISK.to_string()),
        delete_mode: Some(SESSION_DELETE_MODE_METADATA_CLEANUP.to_string()),
        physical_path: None,
        children_count: None,
        continuation: ProviderContinuationProjection::default(),
    }
}

pub(crate) fn finalize_existing_catalog_entry(
    mut entry: WorkspaceSessionCatalogEntry,
    metadata_by_workspace_id: &HashMap<String, WorkspaceSessionCatalogMetadata>,
) -> WorkspaceSessionCatalogEntry {
    mark_entry_as_existing_on_disk(&mut entry);
    apply_engine_provider_binding(&mut entry, metadata_by_workspace_id);
    apply_provider_continuation_metadata(&mut entry, metadata_by_workspace_id);
    apply_codex_provider_home_binding_fallback(&mut entry);
    apply_folder_assignment(&mut entry, metadata_by_workspace_id);
    apply_auto_session_metadata(&mut entry, metadata_by_workspace_id);
    entry
}

pub(crate) fn append_metadata_orphan_entries(
    entries: &mut Vec<WorkspaceSessionCatalogEntry>,
    workspace: &WorkspaceEntry,
    metadata: &WorkspaceSessionCatalogMetadata,
    source_statuses: &[WorkspaceSessionCatalogSourceStatus],
) {
    let existing_session_ids = entries
        .iter()
        .filter(|entry| entry.workspace_id == workspace.id)
        .flat_map(catalog_metadata_lookup_keys_for_entry)
        .collect::<HashSet<_>>();

    let mut metadata_session_ids = metadata
        .archived_at_by_session_id
        .keys()
        .chain(metadata.folder_id_by_session_id.keys())
        .chain(metadata.auto_session_by_session_id.keys())
        .chain(metadata.provider_continuation_by_session_key.keys())
        .cloned()
        .collect::<Vec<_>>();
    metadata_session_ids.sort();
    metadata_session_ids.dedup();

    for session_id in metadata_session_ids {
        if existing_session_ids.contains(&session_id) {
            continue;
        }
        let engine = parse_catalog_identity(&session_id).engine_name();
        if source_status_is_incomplete_for_engine(source_statuses, engine) {
            continue;
        }
        let auto_session =
            auto_session_metadata_for_session(metadata, &workspace.id, &session_id, engine)
                .cloned();
        if auto_session
            .as_ref()
            .is_some_and(|metadata| metadata.visibility == AutoSessionVisibility::Hidden)
        {
            continue;
        }
        let folder_id =
            folder_assignment_for_session(metadata, &workspace.id, &session_id, engine).cloned();
        entries.push(build_metadata_orphan_entry(
            workspace,
            &session_id,
            archived_at_for_session(metadata, &workspace.id, &session_id),
            folder_id,
            auto_session,
        ));
    }
}

pub(crate) fn apply_children_counts(entries: &mut [WorkspaceSessionCatalogEntry]) {
    let mut children_by_parent = HashMap::<String, usize>::new();
    for entry in entries.iter() {
        let Some(parent_id) = entry.parent_session_id.as_deref() else {
            continue;
        };
        *children_by_parent.entry(parent_id.to_string()).or_insert(0) += 1;
    }
    for entry in entries.iter_mut() {
        if let Some(count) = children_by_parent.get(&entry.session_id).copied() {
            entry.children_count = Some(count);
        }
    }
}

pub(crate) fn push_orphan_entries_for_scope(
    entries: &mut Vec<WorkspaceSessionCatalogEntry>,
    workspace_scope: &[WorkspaceEntry],
    metadata_by_workspace_id: &HashMap<String, WorkspaceSessionCatalogMetadata>,
    source_statuses: &[WorkspaceSessionCatalogSourceStatus],
) {
    for workspace in workspace_scope {
        if let Some(metadata) = metadata_by_workspace_id.get(&workspace.id) {
            append_metadata_orphan_entries(entries, workspace, metadata, source_statuses);
        }
    }
}

fn source_status_is_incomplete_for_engine(
    source_statuses: &[WorkspaceSessionCatalogSourceStatus],
    engine: &str,
) -> bool {
    source_status_for_engine(source_statuses, engine)
        .map(|status| {
            matches!(
                status.completeness,
                WorkspaceSessionSourceCompleteness::Partial
                    | WorkspaceSessionSourceCompleteness::Degraded
                    | WorkspaceSessionSourceCompleteness::UncertainEmpty
            )
        })
        .unwrap_or(false)
}

pub(crate) fn should_replace_global_entry(
    current: &WorkspaceSessionCatalogEntry,
    candidate: &WorkspaceSessionCatalogEntry,
) -> bool {
    let current_resolved = current.workspace_id != SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID;
    let candidate_resolved = candidate.workspace_id != SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID;
    if current_resolved != candidate_resolved {
        return candidate_resolved;
    }
    candidate.updated_at > current.updated_at
}
pub(crate) fn catalog_metadata_path(storage_path: &Path, workspace_id: &str) -> Result<PathBuf, String> {
    let data_dir = storage_path
        .parent()
        .ok_or_else(|| format!("storage path has no parent: {}", storage_path.display()))?;
    Ok(data_dir
        .join("session-management")
        .join("workspaces")
        .join(format!("{workspace_id}.json")))
}

fn qoder_legacy_stable_metadata_raw_id<'a>(workspace_id: &str, key: &'a str) -> Option<&'a str> {
    if qoder_profile_qualified_metadata_key_parts(key).is_some() {
        return None;
    }
    let stable_prefix = format!("qoder:{}:", workspace_id.trim());
    key.strip_prefix(&stable_prefix)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn qoder_legacy_metadata_profile_by_raw(
    metadata: &WorkspaceSessionCatalogMetadata,
    workspace_id: &str,
) -> HashMap<String, Option<&'static str>> {
    metadata
        .engine_provider_binding_by_session_key
        .iter()
        .filter_map(|(key, binding)| {
            let raw_session_id = qoder_legacy_stable_metadata_raw_id(workspace_id, key)?;
            let provider_profile_id =
                engine::qoder_provider_profile::qoder_canonical_provider_profile_id(Some(
                    binding.provider_profile_id.as_str(),
                ))
                .ok();
            Some((raw_session_id.to_string(), provider_profile_id))
        })
        .collect()
}

fn normalized_qoder_metadata_key(
    key: &str,
    workspace_id: &str,
    profile_by_raw_session_id: &HashMap<String, Option<&'static str>>,
) -> Option<String> {
    let key = key.trim();
    if !key.starts_with("qoder:") || qoder_profile_qualified_metadata_key_parts(key).is_some() {
        return None;
    }
    if let Some(raw_session_id) = qoder_legacy_stable_metadata_raw_id(workspace_id, key) {
        let provider_profile_id = match profile_by_raw_session_id.get(raw_session_id) {
            Some(Some(provider_profile_id)) => Some(*provider_profile_id),
            Some(None) => return None,
            None => None,
        };
        let identity = engine::qoder_provider_profile::parse_qoder_native_session_identity(
            raw_session_id,
            provider_profile_id,
        )
        .ok()?;
        return Some(format!(
            "qoder:{}:{}:{}",
            workspace_id.trim(),
            identity.provider_profile_id,
            identity.raw_session_id
        ));
    }

    let identity =
        engine::qoder_provider_profile::parse_qoder_native_session_identity(key, None).ok()?;
    if !identity.is_legacy {
        return Some(identity.canonical_id());
    }
    // 旧 alias 的 raw ACP id 没有分发分段；多冒号值无法确定其是否原本是
    // workspace metadata key，保留原样比猜错 distribution 更安全。
    if identity.raw_session_id.contains(':') {
        return None;
    }
    let provider_profile_id = match profile_by_raw_session_id.get(identity.raw_session_id.as_str())
    {
        Some(Some(provider_profile_id)) => Some(*provider_profile_id),
        Some(None) => return None,
        None => None,
    };
    engine::qoder_provider_profile::parse_qoder_native_session_identity(key, provider_profile_id)
        .ok()
        .map(|identity| identity.canonical_id())
}

fn rekey_legacy_qoder_metadata_map<T>(
    map: &mut HashMap<String, T>,
    workspace_id: &str,
    profile_by_raw_session_id: &HashMap<String, Option<&'static str>>,
) {
    let mut legacy_entries = Vec::new();
    for (key, value) in std::mem::take(map) {
        match normalized_qoder_metadata_key(&key, workspace_id, profile_by_raw_session_id) {
            Some(normalized_key) if normalized_key != key => {
                legacy_entries.push((normalized_key, value));
            }
            _ => {
                map.insert(key, value);
            }
        }
    }
    // 已经 profile-qualified 的新 key 优先，避免旧 raw alias 覆盖新写入事实。
    for (normalized_key, value) in legacy_entries {
        map.entry(normalized_key).or_insert(value);
    }
}

/// Read-time compatibility migration for metadata written before Qoder Native
/// identity carried its distribution. Mutating callers persist the normalized
/// maps through their existing atomic write; readonly callers still query the
/// correct Global/CN key without changing user storage.
pub(crate) fn normalize_legacy_qoder_catalog_metadata(
    metadata: &mut WorkspaceSessionCatalogMetadata,
    workspace_id: &str,
) {
    let profile_by_raw_session_id = qoder_legacy_metadata_profile_by_raw(metadata, workspace_id);
    rekey_legacy_qoder_metadata_map(
        &mut metadata.archived_at_by_session_id,
        workspace_id,
        &profile_by_raw_session_id,
    );
    rekey_legacy_qoder_metadata_map(
        &mut metadata.folder_id_by_session_id,
        workspace_id,
        &profile_by_raw_session_id,
    );
    rekey_legacy_qoder_metadata_map(
        &mut metadata.auto_session_by_session_id,
        workspace_id,
        &profile_by_raw_session_id,
    );
    rekey_legacy_qoder_metadata_map(
        &mut metadata.engine_provider_binding_by_session_key,
        workspace_id,
        &profile_by_raw_session_id,
    );
    rekey_legacy_qoder_metadata_map(
        &mut metadata.provider_continuation_by_session_key,
        workspace_id,
        &profile_by_raw_session_id,
    );
}

pub(crate) fn read_catalog_metadata(
    storage_path: &Path,
    workspace_id: &str,
) -> Result<WorkspaceSessionCatalogMetadata, String> {
    let path = catalog_metadata_path(storage_path, workspace_id)?;
    let mut metadata =
        read_json_file::<WorkspaceSessionCatalogMetadata>(&path)?.unwrap_or_default();
    normalize_legacy_qoder_catalog_metadata(&mut metadata, workspace_id);
    Ok(metadata)
}

pub(crate) fn read_workspace_session_folder_assignments(
    storage_path: &Path,
    workspace_id: &str,
) -> Result<HashMap<String, String>, String> {
    Ok(read_catalog_metadata(storage_path, workspace_id)?.folder_id_by_session_id)
}

pub(crate) fn read_codex_provider_bindings(
    storage_path: &Path,
    workspace_id: &str,
) -> Result<HashMap<String, CodexProviderBinding>, String> {
    Ok(read_catalog_metadata(storage_path, workspace_id)?.codex_provider_binding_by_session_id)
}

pub(crate) fn read_catalog_metadata_for_scope(
    storage_path: &Path,
    workspaces: &[WorkspaceEntry],
) -> Result<HashMap<String, WorkspaceSessionCatalogMetadata>, String> {
    let mut metadata_by_workspace_id = HashMap::new();
    for workspace in workspaces {
        metadata_by_workspace_id.insert(
            workspace.id.clone(),
            read_catalog_metadata(storage_path, &workspace.id)?,
        );
    }
    Ok(metadata_by_workspace_id)
}

pub(crate) fn write_catalog_metadata_unlocked(
    path: &Path,
    metadata: &WorkspaceSessionCatalogMetadata,
) -> Result<(), String> {
    let data = serde_json::to_string_pretty(metadata)
        .map_err(|error| format!("failed to serialize {}: {error}", path.display()))?;
    write_string_atomically(path, &data)
}

pub(crate) fn read_catalog_metadata_from_path(
    path: &Path,
    workspace_id: &str,
) -> Result<WorkspaceSessionCatalogMetadata, String> {
    let mut metadata = read_json_file::<WorkspaceSessionCatalogMetadata>(path)?.unwrap_or_default();
    normalize_legacy_qoder_catalog_metadata(&mut metadata, workspace_id);
    Ok(metadata)
}

pub(crate) fn with_catalog_metadata_mutation<T>(
    storage_path: &Path,
    workspace_id: &str,
    mutation: impl FnOnce(&mut WorkspaceSessionCatalogMetadata) -> Result<T, String>,
) -> Result<T, String> {
    let path = catalog_metadata_path(storage_path, workspace_id)?;
    with_storage_lock(&path, || {
        let mut metadata = read_catalog_metadata_from_path(&path, workspace_id)?;
        let result = mutation(&mut metadata)?;
        write_catalog_metadata_unlocked(&path, &metadata)?;
        Ok(result)
    })
}

pub(crate) async fn ensure_workspace_exists(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<(), String> {
    let workspaces = workspaces.lock().await;
    if workspaces.contains_key(workspace_id) {
        Ok(())
    } else {
        Err("workspace not found".to_string())
    }
}

pub(crate) fn sort_workspace_session_folders(folders: &mut [WorkspaceSessionFolder]) {
    folders.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.created_at.cmp(&right.created_at))
            .then_with(|| left.id.cmp(&right.id))
    });
}

pub(crate) fn folder_exists(metadata: &WorkspaceSessionCatalogMetadata, folder_id: &str) -> bool {
    metadata.folders.iter().any(|folder| folder.id == folder_id)
}

pub(crate) fn folder_subtree_ids(
    metadata: &WorkspaceSessionCatalogMetadata,
    folder_id: &str,
) -> HashSet<String> {
    let mut subtree_ids = HashSet::from([folder_id.to_string()]);
    loop {
        let previous_len = subtree_ids.len();
        for folder in &metadata.folders {
            let parent_in_subtree = folder
                .parent_id
                .as_deref()
                .map(|parent_id| subtree_ids.contains(parent_id))
                .unwrap_or(false);
            if parent_in_subtree {
                subtree_ids.insert(folder.id.clone());
            }
        }
        if subtree_ids.len() == previous_len {
            return subtree_ids;
        }
    }
}

pub(crate) fn would_create_folder_cycle(
    metadata: &WorkspaceSessionCatalogMetadata,
    folder_id: &str,
    parent_id: Option<&str>,
) -> bool {
    let Some(mut current_parent_id) = parent_id else {
        return false;
    };
    if current_parent_id == folder_id {
        return true;
    }

    let parent_by_id: HashMap<&str, Option<&str>> = metadata
        .folders
        .iter()
        .map(|folder| (folder.id.as_str(), folder.parent_id.as_deref()))
        .collect();

    let mut seen = HashSet::new();
    loop {
        if !seen.insert(current_parent_id) {
            return true;
        }
        if current_parent_id == folder_id {
            return true;
        }
        match parent_by_id.get(current_parent_id).copied().flatten() {
            Some(next_parent_id) => current_parent_id = next_parent_id,
            None => return false,
        }
    }
}

pub(crate) fn apply_folder_assignment(
    entry: &mut WorkspaceSessionCatalogEntry,
    metadata_by_workspace_id: &HashMap<String, WorkspaceSessionCatalogMetadata>,
) {
    entry.folder_id = metadata_by_workspace_id
        .get(&entry.workspace_id)
        .and_then(|metadata| folder_assignment_for_entry(metadata, entry))
        .cloned();
}

fn auto_session_metadata_for_entry<'a>(
    metadata: &'a WorkspaceSessionCatalogMetadata,
    entry: &WorkspaceSessionCatalogEntry,
) -> Option<&'a AutoSessionMetadata> {
    catalog_metadata_lookup_keys_for_entry(entry)
        .into_iter()
        .find_map(|key| metadata.auto_session_by_session_id.get(&key))
}

fn apply_auto_session_metadata(
    entry: &mut WorkspaceSessionCatalogEntry,
    metadata_by_workspace_id: &HashMap<String, WorkspaceSessionCatalogMetadata>,
) {
    let Some(metadata) = metadata_by_workspace_id.get(&entry.workspace_id) else {
        return;
    };
    let Some(auto_session) = auto_session_metadata_for_entry(metadata, entry).cloned() else {
        return;
    };
    if auto_session.visibility == AutoSessionVisibility::SystemAuto {
        entry.folder_id = Some(SESSION_FOLDER_SYSTEM_AUTO_ID.to_string());
    }
    entry.auto_session = Some(auto_session);
}

pub(crate) fn auto_session_metadata_for_session<'a>(
    metadata: &'a WorkspaceSessionCatalogMetadata,
    workspace_id: &str,
    session_id: &str,
    engine: &str,
) -> Option<&'a AutoSessionMetadata> {
    catalog_metadata_lookup_keys_for_session(workspace_id, session_id, engine)
        .into_iter()
        .find_map(|key| metadata.auto_session_by_session_id.get(&key))
}

pub(crate) fn apply_strict_attribution_owner(
    mut entry: WorkspaceSessionCatalogEntry,
    workspaces_snapshot: &HashMap<String, WorkspaceEntry>,
    metadata_by_workspace_id: &HashMap<String, WorkspaceSessionCatalogMetadata>,
) -> WorkspaceSessionCatalogEntry {
    let attribution = resolve_catalog_entry_attribution(workspaces_snapshot, &entry);
    if attribution.status == SessionCatalogAttributionStatus::StrictMatch {
        if let Some(matched_workspace_id) = attribution.matched_workspace_id.clone() {
            if let Some(matched_workspace) = workspaces_snapshot.get(&matched_workspace_id) {
                entry.workspace_id = matched_workspace.id.clone();
                entry.workspace_label = Some(matched_workspace.name.clone());
                entry.archived_at = metadata_by_workspace_id
                    .get(&matched_workspace.id)
                    .and_then(|metadata| archived_at_for_entry(metadata, &entry));
            }
        }
    }
    apply_attribution_to_entry(entry, attribution)
}

fn qoder_profile_qualified_metadata_key_parts(session_id: &str) -> Option<(&str, &str, &str)> {
    let mut parts = session_id.splitn(4, ':');
    if parts.next()? != "qoder" {
        return None;
    }
    let workspace_id = parts.next()?.trim();
    let provider_profile_id = parts.next()?.trim();
    let raw_session_id = parts.next()?.trim();
    if workspace_id.is_empty()
        || raw_session_id.is_empty()
        || !matches!(
            provider_profile_id,
            crate::engine::qoder_provider_profile::QODER_GLOBAL_PROVIDER_PROFILE_ID
                | crate::engine::qoder_provider_profile::QODER_CN_PROVIDER_PROFILE_ID
        )
    {
        return None;
    }
    Some((workspace_id, provider_profile_id, raw_session_id))
}

pub(crate) fn is_stable_catalog_metadata_key(session_id: &str) -> bool {
    let mut parts = session_id.splitn(3, ':');
    let engine = parts.next().unwrap_or_default();
    let workspace_id = parts.next().unwrap_or_default();
    let canonical_session_id = parts.next().unwrap_or_default();
    if engine == "qoder" {
        // `qoder:<profile>:<raw>` 是 durable Native identity，不是
        // workspace-scoped metadata key；后者必须多出一个 profile segment。
        return qoder_profile_qualified_metadata_key_parts(session_id).is_some();
    }
    matches!(
        engine,
        "codex" | "claude" | "gemini" | "grok" | "kimi" | "pi" | "omp" | "opencode" | "shared"
    ) && !workspace_id.trim().is_empty()
        && !canonical_session_id.trim().is_empty()
}

pub(crate) fn engine_provider_binding_stable_key(
    workspace_id: &str,
    session_id: &str,
    engine: &str,
    provider_profile_id: Option<&str>,
) -> Option<String> {
    let workspace_id = workspace_id.trim();
    let session_id = session_id.trim();
    let engine = engine.trim().to_ascii_lowercase();
    if workspace_id.is_empty() || session_id.is_empty() || engine.is_empty() {
        return None;
    }

    if engine == "qoder" {
        if qoder_profile_qualified_metadata_key_parts(session_id)
            .is_some_and(|(stored_workspace_id, _, _)| stored_workspace_id == workspace_id)
        {
            return Some(session_id.to_string());
        }
        let identity = crate::engine::qoder_provider_profile::parse_qoder_native_session_identity(
            session_id,
            provider_profile_id,
        )
        .ok()?;
        return Some(format!(
            "qoder:{workspace_id}:{}:{}",
            identity.provider_profile_id, identity.raw_session_id
        ));
    }

    let canonical_session_id = if is_stable_catalog_metadata_key(session_id) {
        session_id.splitn(3, ':').nth(2).unwrap_or(session_id)
    } else {
        session_id
            .strip_prefix(&format!("{engine}:"))
            .unwrap_or(session_id)
    };
    Some(format!("{engine}:{workspace_id}:{canonical_session_id}"))
}

pub(crate) fn metadata_stable_key_for_session_id(workspace_id: &str, session_id: &str) -> String {
    let workspace_id = workspace_id.trim();
    let session_id = session_id.trim();
    if session_id.starts_with("qoder:") {
        if qoder_profile_qualified_metadata_key_parts(session_id)
            .is_some_and(|(stored_workspace_id, _, _)| stored_workspace_id == workspace_id)
        {
            return session_id.to_string();
        }
        let identity = parse_catalog_identity(session_id);
        if let SessionCatalogIdentity::Qoder {
            session_id,
            provider_profile_id: Some(provider_profile_id),
        } = &identity
        {
            return format!("qoder:{workspace_id}:{provider_profile_id}:{session_id}");
        }
    }
    if is_stable_catalog_metadata_key(session_id) {
        return session_id.to_string();
    }
    let identity = parse_catalog_identity(session_id);
    if let SessionCatalogIdentity::Qoder {
        session_id,
        provider_profile_id: Some(provider_profile_id),
    } = &identity
    {
        return format!("qoder:{workspace_id}:{provider_profile_id}:{session_id}");
    }
    format!(
        "{}:{}:{}",
        identity.engine_name(),
        workspace_id,
        identity.raw_session_id()
    )
}

fn append_legacy_global_qoder_metadata_key(
    keys: &mut Vec<String>,
    workspace_id: &str,
    session_id: &str,
    provider_profile_id: Option<&str>,
) {
    let Ok(identity) = crate::engine::qoder_provider_profile::parse_qoder_native_session_identity(
        session_id,
        provider_profile_id,
    ) else {
        return;
    };
    if identity.provider_profile_id
        == crate::engine::qoder_provider_profile::QODER_GLOBAL_PROVIDER_PROFILE_ID
    {
        keys.push(format!("qoder:{workspace_id}:{}", identity.raw_session_id));
    }
}

pub(crate) fn folder_assignment_keys_for_session(session_id: &str, engine: &str) -> Vec<String> {
    let trimmed_session_id = session_id.trim();
    let normalized_engine = engine.trim().to_ascii_lowercase();
    let mut keys = Vec::new();
    if trimmed_session_id.is_empty() {
        return keys;
    }

    keys.push(trimmed_session_id.to_string());
    if normalized_engine == "codex" {
        if let Some(raw_session_id) = trimmed_session_id.strip_prefix("codex:") {
            if !raw_session_id.is_empty() {
                keys.push(raw_session_id.to_string());
            }
        } else {
            keys.push(format!("codex:{trimmed_session_id}"));
        }
    }
    keys.sort();
    keys.dedup();
    keys
}

pub(crate) fn provider_continuation_stable_key_for_session_id(workspace_id: &str, session_id: &str) -> String {
    let identity = parse_catalog_identity(session_id);
    if identity.engine_name() == "codex" {
        let raw_session_id = identity
            .raw_session_id()
            .strip_prefix("codex:")
            .unwrap_or(identity.raw_session_id());
        return format!("codex:{workspace_id}:{raw_session_id}");
    }
    metadata_stable_key_for_session_id(workspace_id, session_id)
}

fn append_legacy_codex_continuation_key(
    keys: &mut Vec<String>,
    workspace_id: &str,
    session_id: &str,
    engine: &str,
) {
    if !engine.eq_ignore_ascii_case("codex") {
        return;
    }
    let raw_session_id = session_id.strip_prefix("codex:").unwrap_or(session_id);
    if !raw_session_id.is_empty() {
        keys.push(format!("codex:{workspace_id}:codex:{raw_session_id}"));
    }
}

pub(crate) fn catalog_metadata_lookup_keys_for_entry(entry: &WorkspaceSessionCatalogEntry) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(stable_key) = entry
        .stable_session_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        keys.push(stable_key.to_string());
    } else {
        keys.push(build_catalog_entry_stable_key(entry));
    }
    keys.extend(folder_assignment_keys_for_session(
        &entry.session_id,
        &entry.engine,
    ));
    if entry.engine.eq_ignore_ascii_case("qoder") {
        append_legacy_global_qoder_metadata_key(
            &mut keys,
            &entry.workspace_id,
            &entry.session_id,
            entry.provider_profile_id.as_deref(),
        );
    }
    append_legacy_codex_continuation_key(
        &mut keys,
        &entry.workspace_id,
        &entry.session_id,
        &entry.engine,
    );
    keys.sort();
    keys.dedup();
    keys
}

pub(crate) fn catalog_metadata_lookup_keys_for_session(
    workspace_id: &str,
    session_id: &str,
    engine: &str,
) -> Vec<String> {
    let mut keys = vec![metadata_stable_key_for_session_id(workspace_id, session_id)];
    keys.extend(folder_assignment_keys_for_session(session_id, engine));
    if engine.eq_ignore_ascii_case("qoder") {
        append_legacy_global_qoder_metadata_key(&mut keys, workspace_id, session_id, None);
    }
    append_legacy_codex_continuation_key(&mut keys, workspace_id, session_id, engine);
    keys.sort();
    keys.dedup();
    keys
}

pub(crate) fn codex_provider_binding_for_session(
    metadata: &WorkspaceSessionCatalogMetadata,
    workspace_id: &str,
    session_id: &str,
) -> Option<CodexProviderBinding> {
    catalog_metadata_lookup_keys_for_session(workspace_id, session_id, "codex")
        .into_iter()
        .find_map(|key| {
            metadata
                .codex_provider_binding_by_session_id
                .get(&key)
                .cloned()
        })
}

pub(crate) fn engine_provider_binding_for_session(
    metadata: &WorkspaceSessionCatalogMetadata,
    workspace_id: &str,
    session_id: &str,
    engine: &str,
) -> Option<EngineProviderBinding> {
    if engine.eq_ignore_ascii_case("qoder") {
        return qoder_provider_binding_for_session(metadata, workspace_id, session_id);
    }

    engine_provider_binding_stable_key(workspace_id, session_id, engine, None)
        .and_then(|key| {
            metadata
                .engine_provider_binding_by_session_key
                .get(&key)
                .cloned()
        })
        .or_else(|| {
            engine
                .eq_ignore_ascii_case("codex")
                .then(|| codex_provider_binding_for_session(metadata, workspace_id, session_id))
                .flatten()
        })
}

fn qoder_provider_binding_matches_profile(
    binding: &EngineProviderBinding,
    provider_profile_id: &str,
) -> bool {
    matches!(
        crate::engine::qoder_provider_profile::qoder_canonical_provider_profile_id(Some(
            binding.provider_profile_id.as_str(),
        )),
        Ok(binding_provider_profile_id) if binding_provider_profile_id == provider_profile_id
    )
}

fn unique_rekeyed_qoder_binding_for_legacy_session(
    metadata: &WorkspaceSessionCatalogMetadata,
    workspace_id: &str,
    raw_session_id: &str,
) -> Option<EngineProviderBinding> {
    let mut matched_binding = None;
    for (key, binding) in &metadata.engine_provider_binding_by_session_key {
        let Some((stored_workspace_id, stored_profile_id, stored_raw_session_id)) =
            qoder_profile_qualified_metadata_key_parts(key)
        else {
            continue;
        };
        if stored_workspace_id != workspace_id
            || stored_raw_session_id != raw_session_id
            || !qoder_provider_binding_matches_profile(binding, stored_profile_id)
        {
            continue;
        }
        if matched_binding.is_some() {
            return None;
        }
        matched_binding = Some(binding.clone());
    }
    matched_binding
}

fn legacy_qoder_session_has_unresolved_binding(
    metadata: &WorkspaceSessionCatalogMetadata,
    workspace_id: &str,
    raw_session_id: &str,
) -> bool {
    let legacy_stable_key = format!("qoder:{workspace_id}:{raw_session_id}");
    let legacy_alias_key = format!("qoder:{raw_session_id}");
    metadata
        .engine_provider_binding_by_session_key
        .iter()
        .any(|(key, binding)| {
            if key == &legacy_stable_key || key == &legacy_alias_key {
                return crate::engine::qoder_provider_profile::qoder_canonical_provider_profile_id(
                    Some(binding.provider_profile_id.as_str()),
                )
                .is_err();
            }
            qoder_profile_qualified_metadata_key_parts(key).is_some_and(
                |(stored_workspace_id, stored_profile_id, stored_raw_session_id)| {
                    stored_workspace_id == workspace_id
                        && stored_raw_session_id == raw_session_id
                        && !qoder_provider_binding_matches_profile(binding, stored_profile_id)
                },
            )
        })
}

fn qoder_provider_binding_for_session(
    metadata: &WorkspaceSessionCatalogMetadata,
    workspace_id: &str,
    session_id: &str,
) -> Option<EngineProviderBinding> {
    let identity = crate::engine::qoder_provider_profile::parse_qoder_native_session_identity(
        session_id, None,
    )
    .ok()?;
    let stable_key = engine_provider_binding_stable_key(workspace_id, session_id, "qoder", None)?;
    if let Some(binding) = metadata
        .engine_provider_binding_by_session_key
        .get(&stable_key)
    {
        return qoder_provider_binding_matches_profile(binding, identity.provider_profile_id)
            .then(|| binding.clone());
    }

    let legacy_key = format!("qoder:{workspace_id}:{}", identity.raw_session_id);
    if let Some(binding) = metadata
        .engine_provider_binding_by_session_key
        .get(&legacy_key)
    {
        let binding_provider_profile_id =
            crate::engine::qoder_provider_profile::qoder_canonical_provider_profile_id(Some(
                binding.provider_profile_id.as_str(),
            ))
            .ok()?;
        return (identity.is_legacy || binding_provider_profile_id == identity.provider_profile_id)
            .then(|| binding.clone());
    }

    identity
        .is_legacy
        .then(|| {
            unique_rekeyed_qoder_binding_for_legacy_session(
                metadata,
                workspace_id,
                &identity.raw_session_id,
            )
        })
        .flatten()
}

pub(crate) fn provider_profile_id_for_session_at_path(
    storage_path: &Path,
    workspace_id: &str,
    session_id: &str,
    engine: &str,
) -> Result<Option<String>, String> {
    let metadata = read_catalog_metadata(storage_path, workspace_id)?;
    Ok(
        engine_provider_binding_for_session(&metadata, workspace_id, session_id, engine)
            .map(|binding| binding.provider_profile_id),
    )
}

/// Session Index list overlay：对缺 provider 的行按绑定账本补齐，
/// codex 额外从 physical_path 的 provider-home 段落兜底推断。
/// 账本缺失 / 损坏时静默降级为无标签，绝不让 list 失败。
pub(crate) fn overlay_session_index_provider_bindings(
    storage_path: &Path,
    workspace_id: &str,
    rows: &mut [crate::session_index::store::SessionIndexRow],
) {
    let needs_overlay = rows
        .iter()
        .any(|row| row.provider_profile_id.is_none() || row.provider_profile_name.is_none());
    if !needs_overlay {
        return;
    }
    let metadata = read_catalog_metadata(storage_path, workspace_id).unwrap_or_default();
    for row in rows.iter_mut() {
        if row.provider_profile_id.is_some() && row.provider_profile_name.is_some() {
            continue;
        }
        let binding = engine_provider_binding_for_session(
            &metadata,
            workspace_id,
            &row.session_id,
            &row.engine,
        );
        if let Some(binding) = binding {
            if row.provider_profile_id.is_none() {
                row.provider_profile_id = Some(binding.provider_profile_id);
            }
            if row.provider_profile_name.is_none() {
                row.provider_profile_name = Some(binding.provider_profile_name);
            }
            continue;
        }
        // codex 兜底：rollout 落在 codex-provider-homes/<profileId>/ 下但账本缺行。
        if !row.engine.eq_ignore_ascii_case("codex") || row.provider_profile_id.is_some() {
            continue;
        }
        let physical_path = row
            .physical_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let Some(profile_id) = physical_path.and_then(|path| {
            crate::local_usage::infer_managed_codex_provider_profile_id_from_session_path(
                Path::new(path),
            )
        }) else {
            continue;
        };
        let binding =
            crate::codex::provider_profile::codex_provider_binding_for_profile_id(&profile_id);
        row.provider_profile_id = Some(binding.provider_profile_id);
        if row.provider_profile_name.is_none() {
            row.provider_profile_name = Some(binding.provider_profile_name);
        }
    }
}

pub(crate) fn resolve_engine_provider_profile_id(
    storage_path: &Path,
    workspace_id: &str,
    session_id: Option<&str>,
    engine: &str,
    requested_provider_profile_id: Option<&str>,
) -> Result<Option<String>, String> {
    let requested_provider_profile_id = requested_provider_profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let session_id = session_id.map(str::trim).filter(|value| !value.is_empty());

    if engine.eq_ignore_ascii_case("qoder") {
        if let Some(session_id) = session_id {
            let identity = engine::qoder_provider_profile::parse_qoder_native_session_identity(
                session_id,
                requested_provider_profile_id,
            )?;

            // A canonical id or explicitly requested distribution is authoritative.
            // Old raw ids have no durable distribution in their text, so retain a
            // pre-migration binding when one exists before falling back to Global.
            if !identity.is_legacy
                || engine::qoder_provider_profile::has_explicit_qoder_distribution_owner(
                    requested_provider_profile_id,
                )
            {
                return Ok(Some(identity.provider_profile_id.to_string()));
            }
            let metadata = read_catalog_metadata(storage_path, workspace_id)?;
            if let Some(binding) =
                engine_provider_binding_for_session(&metadata, workspace_id, session_id, engine)
            {
                let provider_profile_id =
                    engine::qoder_provider_profile::qoder_canonical_provider_profile_id(Some(
                        binding.provider_profile_id.as_str(),
                    ))?;
                return Ok(Some(provider_profile_id.to_string()));
            }
            if legacy_qoder_session_has_unresolved_binding(
                &metadata,
                workspace_id,
                &identity.raw_session_id,
            ) {
                return Err(format!(
                    "Qoder legacy session `{}` has an unresolved provider binding; refusing Global fallback",
                    identity.raw_session_id
                ));
            }
            return Ok(Some(identity.provider_profile_id.to_string()));
        }
        return Ok(requested_provider_profile_id.map(ToString::to_string));
    }

    if let Some(requested) = requested_provider_profile_id {
        return Ok(Some(requested.to_string()));
    }
    let Some(session_id) = session_id else {
        return Ok(None);
    };
    let metadata = read_catalog_metadata(storage_path, workspace_id)?;
    Ok(
        engine_provider_binding_for_session(&metadata, workspace_id, session_id, engine)
            .map(|binding| binding.provider_profile_id),
    )
}

fn apply_engine_provider_binding(
    entry: &mut WorkspaceSessionCatalogEntry,
    metadata_by_workspace_id: &HashMap<String, WorkspaceSessionCatalogMetadata>,
) {
    let Some(metadata) = metadata_by_workspace_id.get(&entry.workspace_id) else {
        return;
    };
    let Some(binding) = engine_provider_binding_for_session(
        metadata,
        &entry.workspace_id,
        &entry.session_id,
        &entry.engine,
    ) else {
        return;
    };
    entry.provider_profile_id = Some(binding.provider_profile_id);
    entry.provider_profile_source = Some(binding.provider_profile_source);
    entry.provider_profile_name = Some(binding.provider_profile_name.clone());
    entry.provider_availability = Some(binding.provider_availability);
    entry.source_label = Some(binding.provider_profile_name);
}

fn apply_provider_continuation_metadata(
    entry: &mut WorkspaceSessionCatalogEntry,
    metadata_by_workspace_id: &HashMap<String, WorkspaceSessionCatalogMetadata>,
) {
    let Some(metadata) = metadata_by_workspace_id.get(&entry.workspace_id) else {
        return;
    };
    let continuation = resolve_provider_continuation_metadata(
        metadata,
        &entry.workspace_id,
        &entry.session_id,
        &entry.engine,
    );
    if let Some(continuation) = continuation {
        entry.continuation = continuation.into();
    }
}

fn stored_provider_continuation_metadata(
    metadata: &WorkspaceSessionCatalogMetadata,
    workspace_id: &str,
    session_id: &str,
    engine: &str,
) -> Option<ProviderContinuationMetadata> {
    catalog_metadata_lookup_keys_for_session(workspace_id, session_id, engine)
        .into_iter()
        .find_map(|key| metadata.provider_continuation_by_session_key.get(&key))
        .cloned()
}

pub(crate) fn resolve_provider_continuation_metadata(
    metadata: &WorkspaceSessionCatalogMetadata,
    workspace_id: &str,
    session_id: &str,
    engine: &str,
) -> Option<ProviderContinuationMetadata> {
    fn resolve(
        metadata: &WorkspaceSessionCatalogMetadata,
        workspace_id: &str,
        session_id: &str,
        engine: &str,
        visited: &mut HashSet<String>,
    ) -> Option<ProviderContinuationMetadata> {
        let mut continuation =
            stored_provider_continuation_metadata(metadata, workspace_id, session_id, engine)?;
        let visit_key = format!("{engine}:{session_id}");
        if !visited.insert(visit_key) {
            return Some(continuation);
        }

        let source_session_id = continuation.source_session_id.clone();
        let source_engine = parse_catalog_identity(&source_session_id)
            .engine_name()
            .to_string();
        if let Some(source_family) = resolve(
            metadata,
            workspace_id,
            &source_session_id,
            &source_engine,
            visited,
        ) {
            continuation.family_id = source_family.family_id;
            continuation.family_root_session_id = source_family.family_root_session_id;
            continuation.lineage_depth = source_family.lineage_depth.saturating_add(1);
        } else {
            let source_key =
                provider_continuation_stable_key_for_session_id(workspace_id, &source_session_id);
            continuation.family_id = source_key.clone();
            continuation.family_root_session_id = source_key;
            continuation.lineage_depth = 1;
        }
        Some(continuation)
    }

    resolve(
        metadata,
        workspace_id,
        session_id,
        engine,
        &mut HashSet::new(),
    )
}

pub(crate) fn apply_codex_provider_home_binding_fallback(entry: &mut WorkspaceSessionCatalogEntry) {
    if !entry.engine.eq_ignore_ascii_case("codex") {
        return;
    }
    if entry.provider_profile_name.is_some() && entry.provider_availability.is_some() {
        return;
    }
    let Some(provider_profile_id) = entry
        .provider_profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
    else {
        return;
    };
    let binding =
        crate::codex::provider_profile::codex_provider_binding_for_profile_id(&provider_profile_id);
    entry.provider_profile_id = Some(binding.provider_profile_id);
    entry.provider_profile_source = Some(binding.provider_profile_source);
    entry.provider_profile_name = Some(binding.provider_profile_name.clone());
    entry.provider_availability = Some(binding.provider_availability);
    entry.source_label = Some(binding.provider_profile_name);
}

pub(crate) fn archived_at_for_entry(
    metadata: &WorkspaceSessionCatalogMetadata,
    entry: &WorkspaceSessionCatalogEntry,
) -> Option<i64> {
    catalog_metadata_lookup_keys_for_entry(entry)
        .into_iter()
        .find_map(|key| metadata.archived_at_by_session_id.get(&key).copied())
}

pub(crate) fn archived_at_for_session(
    metadata: &WorkspaceSessionCatalogMetadata,
    workspace_id: &str,
    session_id: &str,
) -> Option<i64> {
    let engine = parse_catalog_identity(session_id).engine_name();
    catalog_metadata_lookup_keys_for_session(workspace_id, session_id, engine)
        .into_iter()
        .find_map(|key| metadata.archived_at_by_session_id.get(&key).copied())
}

fn folder_assignment_for_session<'a>(
    metadata: &'a WorkspaceSessionCatalogMetadata,
    workspace_id: &str,
    session_id: &str,
    engine: &str,
) -> Option<&'a String> {
    catalog_metadata_lookup_keys_for_session(workspace_id, session_id, engine)
        .into_iter()
        .find_map(|key| metadata.folder_id_by_session_id.get(&key))
}

pub(crate) fn folder_assignment_for_entry<'a>(
    metadata: &'a WorkspaceSessionCatalogMetadata,
    entry: &WorkspaceSessionCatalogEntry,
) -> Option<&'a String> {
    catalog_metadata_lookup_keys_for_entry(entry)
        .into_iter()
        .find_map(|key| metadata.folder_id_by_session_id.get(&key))
}

pub(crate) fn remove_folder_assignment_for_session(
    metadata: &mut WorkspaceSessionCatalogMetadata,
    workspace_id: &str,
    session_id: &str,
    engine: &str,
) {
    for key in catalog_metadata_lookup_keys_for_session(workspace_id, session_id, engine) {
        metadata.folder_id_by_session_id.remove(&key);
    }
}

#[cfg(test)]
pub(crate) fn remove_catalog_metadata_for_session(
    metadata: &mut WorkspaceSessionCatalogMetadata,
    workspace_id: &str,
    session_id: &str,
) {
    let engine = parse_catalog_identity(session_id).engine_name();
    for key in catalog_metadata_lookup_keys_for_session(workspace_id, session_id, engine) {
        metadata.archived_at_by_session_id.remove(&key);
        metadata.folder_id_by_session_id.remove(&key);
        metadata.auto_session_by_session_id.remove(&key);
        metadata.engine_provider_binding_by_session_key.remove(&key);
        metadata.codex_provider_binding_by_session_id.remove(&key);
        metadata.provider_continuation_by_session_key.remove(&key);
    }
}

pub(crate) fn remove_catalog_metadata_for_target(
    metadata: &mut WorkspaceSessionCatalogMetadata,
    target: &WorkspaceSessionMutationTarget,
) {
    for key in &target.metadata_lookup_keys {
        metadata.archived_at_by_session_id.remove(key);
        metadata.folder_id_by_session_id.remove(key);
        metadata.auto_session_by_session_id.remove(key);
        metadata.engine_provider_binding_by_session_key.remove(key);
        metadata.codex_provider_binding_by_session_id.remove(key);
        metadata.provider_continuation_by_session_key.remove(key);
    }
}
