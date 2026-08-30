use std::collections::HashMap;
use std::path::{Path, PathBuf};

use tokio::sync::Mutex;

use super::{
    build_workspace_scope_catalog_data, catalog_metadata_path, engine_provider_binding_stable_key,
    ensure_workspace_exists, folder_assignment_keys_for_session, folder_exists, folder_subtree_ids,
    is_invalid_session_path_segment, metadata_stable_key_for_session_id, normalize_folder_id,
    normalize_folder_name, normalize_optional_folder_id, normalize_session_ids, normalize_workspace_id,
    now_millis, parse_catalog_identity, provider_continuation_stable_key_for_session_id,
    read_catalog_metadata, read_catalog_metadata_from_path, remove_folder_assignment_for_session,
    resolve_provider_continuation_metadata, resolve_session_mutation_target,
    sort_workspace_session_folders, unresolved_session_mutation_message, with_catalog_metadata_mutation,
    would_create_folder_cycle, write_catalog_metadata_unlocked, AutoSessionMetadata,
    AutoSessionVisibility, CodexProviderBinding, EngineProviderBinding, ProviderContinuationMetadata,
    SessionCatalogScanMode, WorkspaceSessionAssignmentResponse, WorkspaceSessionFolder,
    WorkspaceSessionFolderMutation, WorkspaceSessionFolderTree, WorkspaceSessionScanQuality,
    SESSION_FOLDER_SYSTEM_AUTO_ID,
};
use crate::engine;
use crate::storage::with_storage_lock;
use crate::types::{WorkspaceEntry, WorkspaceSessionAttributionMode};

fn normalize_auto_session_metadata(
    metadata: AutoSessionMetadata,
) -> Result<AutoSessionMetadata, String> {
    let session_purpose = metadata.session_purpose.trim();
    if session_purpose.is_empty() {
        return Err("sessionPurpose is required".to_string());
    }
    if is_invalid_session_path_segment(session_purpose) {
        return Err("invalid sessionPurpose".to_string());
    }
    let owner_feature = metadata.owner_feature.trim();
    if owner_feature.is_empty() {
        return Err("ownerFeature is required".to_string());
    }
    if is_invalid_session_path_segment(owner_feature) {
        return Err("invalid ownerFeature".to_string());
    }
    Ok(AutoSessionMetadata {
        session_purpose: session_purpose.to_string(),
        visibility: metadata.visibility,
        owner_feature: owner_feature.to_string(),
        auto_archive: metadata.auto_archive,
        created_by: metadata.created_by,
    })
}

pub(crate) async fn list_workspace_session_folders_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
) -> Result<WorkspaceSessionFolderTree, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    let mut metadata = read_catalog_metadata(storage_path, &workspace_id)?;
    if metadata
        .auto_session_by_session_id
        .values()
        .any(|metadata| metadata.visibility == AutoSessionVisibility::SystemAuto)
    {
        metadata
            .folders
            .push(system_auto_session_folder(&workspace_id));
    }
    sort_workspace_session_folders(&mut metadata.folders);
    Ok(WorkspaceSessionFolderTree {
        workspace_id,
        folders: metadata.folders,
    })
}

fn system_auto_session_folder(workspace_id: &str) -> WorkspaceSessionFolder {
    WorkspaceSessionFolder {
        id: SESSION_FOLDER_SYSTEM_AUTO_ID.to_string(),
        workspace_id: workspace_id.to_string(),
        parent_id: None,
        name: "system-auto".to_string(),
        created_at: 0,
        updated_at: 0,
    }
}

pub(crate) async fn record_auto_session_metadata_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
    session_id: String,
    metadata: AutoSessionMetadata,
) -> Result<(), String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    let session_id = normalize_session_ids(vec![session_id])?
        .into_iter()
        .next()
        .ok_or_else(|| "session_id is required".to_string())?;
    let metadata = normalize_auto_session_metadata(metadata)?;
    let engine = parse_catalog_identity(&session_id)
        .engine_name()
        .to_string();
    let stable_key = metadata_stable_key_for_session_id(&workspace_id, &session_id);
    with_catalog_metadata_mutation(storage_path, &workspace_id, |stored| {
        stored
            .auto_session_by_session_id
            .insert(stable_key, metadata.clone());
        for key in folder_assignment_keys_for_session(&session_id, &engine) {
            stored
                .auto_session_by_session_id
                .insert(key, metadata.clone());
        }
        Ok(())
    })
}

pub(crate) async fn record_codex_provider_binding_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
    session_id: String,
    binding: CodexProviderBinding,
) -> Result<(), String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    let session_id = normalize_session_ids(vec![session_id])?
        .into_iter()
        .next()
        .ok_or_else(|| "session_id is required".to_string())?;
    let stable_key = metadata_stable_key_for_session_id(&workspace_id, &session_id);
    with_catalog_metadata_mutation(storage_path, &workspace_id, |stored| {
        stored
            .codex_provider_binding_by_session_id
            .insert(stable_key, binding.clone());
        for key in folder_assignment_keys_for_session(&session_id, "codex") {
            stored
                .codex_provider_binding_by_session_id
                .insert(key, binding.clone());
        }
        Ok(())
    })
}

pub(crate) async fn record_engine_provider_binding_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
    session_id: String,
    engine: String,
    binding: EngineProviderBinding,
) -> Result<bool, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    record_engine_provider_binding_at_path(
        storage_path,
        &workspace_id,
        &session_id,
        &engine,
        &binding,
    )
}

pub(crate) async fn record_provider_continuation_metadata_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
    target_session_id: String,
    source_session_id: String,
    source_provider_profile_id: Option<String>,
) -> Result<ProviderContinuationMetadata, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    let target_session_id = normalize_session_ids(vec![target_session_id])?
        .into_iter()
        .next()
        .ok_or_else(|| "target_session_id is required".to_string())?;
    let source_session_id = normalize_session_ids(vec![source_session_id])?
        .into_iter()
        .next()
        .ok_or_else(|| "source_session_id is required".to_string())?;
    let target_key =
        provider_continuation_stable_key_for_session_id(&workspace_id, &target_session_id);
    let source_key =
        provider_continuation_stable_key_for_session_id(&workspace_id, &source_session_id);

    with_catalog_metadata_mutation(storage_path, &workspace_id, |metadata| {
        let source_family = resolve_provider_continuation_metadata(
            metadata,
            &workspace_id,
            &source_session_id,
            parse_catalog_identity(&source_session_id).engine_name(),
        );
        let continuation = ProviderContinuationMetadata {
            origin_kind: "provider-continuation".to_string(),
            source_session_id: source_session_id.clone(),
            source_provider_profile_id: source_provider_profile_id.clone(),
            family_id: source_family
                .as_ref()
                .map(|family| family.family_id.clone())
                .unwrap_or_else(|| source_key.clone()),
            family_root_session_id: source_family
                .as_ref()
                .map(|family| family.family_root_session_id.clone())
                .unwrap_or_else(|| source_key.clone()),
            lineage_parent_session_id: source_session_id.clone(),
            lineage_kind: "provider-continuation".to_string(),
            lineage_depth: source_family
                .as_ref()
                .map_or(1, |family| family.lineage_depth.saturating_add(1)),
        };
        metadata
            .provider_continuation_by_session_key
            .insert(target_key.clone(), continuation.clone());
        Ok(continuation)
    })
}

pub(crate) fn record_engine_provider_binding_at_path(
    storage_path: &Path,
    workspace_id: &str,
    session_id: &str,
    engine: &str,
    binding: &EngineProviderBinding,
) -> Result<bool, String> {
    let workspace_id = normalize_workspace_id(workspace_id)?;
    let session_id = normalize_session_ids(vec![session_id.to_string()])?
        .into_iter()
        .next()
        .ok_or_else(|| "session_id is required".to_string())?;
    let stable_key = engine_provider_binding_stable_key(
        &workspace_id,
        &session_id,
        engine,
        Some(binding.provider_profile_id.as_str()),
    )
    .ok_or_else(|| "engine is required".to_string())?;
    let path = catalog_metadata_path(storage_path, &workspace_id)?;
    with_storage_lock(&path, || {
        let mut metadata = read_catalog_metadata_from_path(&path, &workspace_id)?;
        if metadata
            .engine_provider_binding_by_session_key
            .get(&stable_key)
            == Some(binding)
        {
            return Ok(false);
        }
        metadata
            .engine_provider_binding_by_session_key
            .insert(stable_key, binding.clone());
        write_catalog_metadata_unlocked(&path, &metadata)?;
        Ok(true)
    })
}

pub(crate) fn schedule_engine_provider_binding_record(
    storage_path: PathBuf,
    workspace_id: String,
    session_id: String,
    engine: String,
    binding: EngineProviderBinding,
) {
    tokio::task::spawn_blocking(move || {
        if let Err(error) = record_engine_provider_binding_at_path(
            &storage_path,
            &workspace_id,
            &session_id,
            &engine,
            &binding,
        ) {
            log::error!(
                "[engine.provider_binding] failed to persist canonical binding engine={} workspace={} session={}: {}",
                engine,
                workspace_id,
                session_id,
                error
            );
        }
    });
}

pub(crate) async fn create_workspace_session_folder_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
    name: String,
    parent_id: Option<String>,
) -> Result<WorkspaceSessionFolderMutation, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    let name = normalize_folder_name(&name)?;
    let parent_id = normalize_optional_folder_id(parent_id)?;

    with_catalog_metadata_mutation(storage_path, &workspace_id, |metadata| {
        if let Some(parent_id) = parent_id.as_deref() {
            if !folder_exists(metadata, parent_id) {
                return Err("target folder not found".to_string());
            }
        }

        let now = now_millis();
        let folder = WorkspaceSessionFolder {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.clone(),
            parent_id,
            name,
            created_at: now,
            updated_at: now,
        };
        metadata.folders.push(folder.clone());
        sort_workspace_session_folders(&mut metadata.folders);
        Ok(WorkspaceSessionFolderMutation { folder })
    })
}

pub(crate) async fn rename_workspace_session_folder_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
    folder_id: String,
    name: String,
) -> Result<WorkspaceSessionFolderMutation, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    let folder_id = normalize_folder_id(&folder_id)?;
    let name = normalize_folder_name(&name)?;

    with_catalog_metadata_mutation(storage_path, &workspace_id, |metadata| {
        let folder = metadata
            .folders
            .iter_mut()
            .find(|folder| folder.id == folder_id)
            .ok_or_else(|| "folder not found".to_string())?;
        folder.name = name;
        folder.updated_at = now_millis();
        let updated = folder.clone();
        sort_workspace_session_folders(&mut metadata.folders);
        Ok(WorkspaceSessionFolderMutation { folder: updated })
    })
}

pub(crate) async fn move_workspace_session_folder_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
    folder_id: String,
    parent_id: Option<String>,
) -> Result<WorkspaceSessionFolderMutation, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    let folder_id = normalize_folder_id(&folder_id)?;
    let parent_id = normalize_optional_folder_id(parent_id)?;

    with_catalog_metadata_mutation(storage_path, &workspace_id, |metadata| {
        if !folder_exists(metadata, &folder_id) {
            return Err("folder not found".to_string());
        }
        if let Some(parent_id) = parent_id.as_deref() {
            if !folder_exists(metadata, parent_id) {
                return Err("target folder not found".to_string());
            }
        }
        if would_create_folder_cycle(metadata, &folder_id, parent_id.as_deref()) {
            return Err("folder tree cannot contain cycles".to_string());
        }

        let folder = metadata
            .folders
            .iter_mut()
            .find(|folder| folder.id == folder_id)
            .ok_or_else(|| "folder not found".to_string())?;
        folder.parent_id = parent_id;
        folder.updated_at = now_millis();
        let updated = folder.clone();
        sort_workspace_session_folders(&mut metadata.folders);
        Ok(WorkspaceSessionFolderMutation { folder: updated })
    })
}

pub(crate) async fn delete_workspace_session_folder_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    _engine_manager: &engine::EngineManager,
    storage_path: &Path,
    workspace_id: String,
    folder_id: String,
) -> Result<(), String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    let folder_id = normalize_folder_id(&folder_id)?;

    with_catalog_metadata_mutation(storage_path, &workspace_id, |metadata| {
        let promoted_parent_id = metadata
            .folders
            .iter()
            .find(|folder| folder.id == folder_id)
            .map(|folder| folder.parent_id.clone())
            .ok_or_else(|| "folder not found".to_string())?
            .filter(|parent_id| folder_exists(metadata, parent_id));
        let subtree_ids = folder_subtree_ids(metadata, &folder_id);
        match promoted_parent_id {
            Some(parent_id) if !subtree_ids.contains(&parent_id) => {
                for assigned_folder_id in metadata.folder_id_by_session_id.values_mut() {
                    if subtree_ids.contains(assigned_folder_id) {
                        *assigned_folder_id = parent_id.clone();
                    }
                }
            }
            _ => {
                metadata
                    .folder_id_by_session_id
                    .retain(|_, assigned_folder_id| !subtree_ids.contains(assigned_folder_id));
            }
        }
        metadata
            .folders
            .retain(|folder| !subtree_ids.contains(&folder.id));
        Ok(())
    })
}

pub(crate) async fn assign_workspace_session_folder_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    engine_manager: &engine::EngineManager,
    storage_path: &Path,
    workspace_id: String,
    session_id: String,
    folder_id: Option<String>,
) -> Result<WorkspaceSessionAssignmentResponse, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    let session_id = normalize_session_ids(vec![session_id])?
        .into_iter()
        .next()
        .ok_or_else(|| "session_id is required".to_string())?;
    let folder_id = normalize_optional_folder_id(folder_id)?;
    let scope_catalog = build_workspace_scope_catalog_data(
        workspaces,
        engine_manager,
        storage_path,
        &workspace_id,
        SessionCatalogScanMode::Exhaustive,
        WorkspaceSessionAttributionMode::Related,
        WorkspaceSessionScanQuality::Full,
    )
    .await?;
    let workspaces_snapshot = workspaces.lock().await.clone();
    let target =
        resolve_session_mutation_target(&scope_catalog.entries, &workspaces_snapshot, &session_id)
            .filter(|target| target.exists_on_disk)
            .ok_or_else(|| {
                unresolved_session_mutation_message(&session_id, &scope_catalog.entries)
            })?;

    with_catalog_metadata_mutation(storage_path, &target.owner_workspace_id, |metadata| {
        if let Some(folder_id) = folder_id.as_deref() {
            if !folder_exists(metadata, folder_id) {
                return Err("target folder not found".to_string());
            }
        }

        remove_folder_assignment_for_session(
            metadata,
            &target.owner_workspace_id,
            &target.stable_session_key,
            &target.engine,
        );
        for key in &target.metadata_lookup_keys {
            metadata.folder_id_by_session_id.remove(key);
        }
        if let Some(folder_id) = folder_id.clone() {
            metadata
                .folder_id_by_session_id
                .insert(target.stable_session_key.clone(), folder_id);
        }
        Ok(WorkspaceSessionAssignmentResponse {
            session_id,
            folder_id,
        })
    })
}
