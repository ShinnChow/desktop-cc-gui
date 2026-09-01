use std::collections::HashMap;
use std::path::{Path, PathBuf};

use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use super::{
    build_catalog_entry_stable_key, build_workspace_scope_catalog_data,
    catalog_metadata_lookup_keys_for_entry, normalize_session_ids, normalize_workspace_id,
    parse_catalog_identity, remove_catalog_metadata_for_target, with_catalog_metadata_mutation,
    SessionCatalogScanMode, WorkspaceSessionBatchMutationResponse,
    WorkspaceSessionBatchMutationResult, WorkspaceSessionCatalogEntry, WorkspaceSessionScanQuality,
    SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID, SESSION_DELETE_CODE_ALREADY_MISSING_CLEANED,
    SESSION_DELETE_CODE_DELETED, SESSION_DELETE_CODE_DELETE_FAILED,
    SESSION_DELETE_CODE_UNSUPPORTED, SESSION_DELETE_MODE_METADATA_CLEANUP,
};
use crate::engine;
use crate::local_usage;
use crate::types::{WorkspaceEntry, WorkspaceSessionAttributionMode};

pub(crate) async fn delete_workspace_sessions_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, std::sync::Arc<crate::codex::WorkspaceSession>>>,
    engine_manager: &engine::EngineManager,
    storage_path: &Path,
    workspace_id: String,
    session_ids: Vec<String>,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    let normalized_session_ids = normalize_session_ids(session_ids)?;
    let ordered_session_ids = normalized_session_ids.clone();
    let mut results = Vec::new();
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
    let mut results_by_session_id: HashMap<String, WorkspaceSessionBatchMutationResult> =
        HashMap::new();
    let mut metadata_cleanup_targets = Vec::new();
    let mut codex_targets_by_owner = HashMap::<String, Vec<WorkspaceSessionMutationTarget>>::new();
    let mut other_targets = Vec::new();

    for session_id in normalized_session_ids {
        let Some(target) = resolve_session_mutation_target(
            &scope_catalog.entries,
            &workspaces_snapshot,
            &session_id,
        ) else {
            let message = unresolved_session_mutation_message(&session_id, &scope_catalog.entries);
            results_by_session_id.insert(
                session_id.clone(),
                batch_error(session_id, "OWNER_WORKSPACE_UNRESOLVED", &message),
            );
            continue;
        };
        if !target.exists_on_disk
            || target.delete_mode.as_deref() == Some(SESSION_DELETE_MODE_METADATA_CLEANUP)
        {
            metadata_cleanup_targets.push(target.clone());
            results_by_session_id.insert(
                target.requested_session_id.clone(),
                batch_already_missing_cleaned_for_target(&target),
            );
            continue;
        }
        if target.engine.eq_ignore_ascii_case("codex") {
            codex_targets_by_owner
                .entry(target.owner_workspace_id.clone())
                .or_default()
                .push(target);
        } else {
            other_targets.push(target);
        }
    }

    for (owner_workspace_id, codex_targets) in codex_targets_by_owner {
        let raw_ids: Vec<String> = codex_targets
            .iter()
            .map(|target| target.native_session_id.clone())
            .collect();
        let delete_results = local_usage::delete_codex_sessions_for_workspace(
            workspaces,
            &owner_workspace_id,
            &raw_ids,
        )
        .await?;
        let results_by_raw_id: HashMap<_, _> = delete_results
            .into_iter()
            .map(|result| (result.session_id.clone(), result))
            .collect();

        for target in codex_targets {
            match results_by_raw_id.get(&target.native_session_id) {
                Some(result) if result.deleted => {
                    metadata_cleanup_targets.push(target.clone());
                    results_by_session_id.insert(
                        target.requested_session_id.clone(),
                        batch_delete_success_for_target(&target),
                    );
                }
                Some(result)
                    if result
                        .error
                        .as_deref()
                        .map(should_settle_delete_as_success)
                        .unwrap_or(false) =>
                {
                    metadata_cleanup_targets.push(target.clone());
                    results_by_session_id.insert(
                        target.requested_session_id.clone(),
                        batch_already_missing_cleaned_for_target(&target),
                    );
                }
                Some(result) => {
                    results_by_session_id.insert(
                        target.requested_session_id.clone(),
                        batch_error(
                            target.requested_session_id,
                            SESSION_DELETE_CODE_DELETE_FAILED,
                            result
                                .error
                                .as_deref()
                                .unwrap_or("Failed to delete Codex session"),
                        ),
                    );
                }
                None => {
                    results_by_session_id.insert(
                        target.requested_session_id.clone(),
                        batch_error(
                            target.requested_session_id,
                            SESSION_DELETE_CODE_DELETE_FAILED,
                            "Missing Codex delete result",
                        ),
                    );
                }
            }
        }
    }

    let claude_config = engine_manager
        .get_engine_config(engine::EngineType::Claude)
        .await;
    let gemini_home_dir = engine_manager
        .get_engine_config(engine::EngineType::Gemini)
        .await
        .and_then(|item| item.home_dir);
    let kimi_home_dir = engine_manager
        .get_engine_config(engine::EngineType::Kimi)
        .await
        .and_then(|item| item.home_dir);
    let grok_home_dir = engine_manager
        .get_engine_config(engine::EngineType::Grok)
        .await
        .and_then(|item| item.home_dir);
    let pi_home_dir = engine_manager
        .get_engine_config(engine::EngineType::Pi)
        .await
        .and_then(|item| item.home_dir);
    let omp_home_dir = engine_manager
        .get_engine_config(engine::EngineType::Omp)
        .await
        .and_then(|item| item.home_dir);
    let qoder_distribution_settings = engine_manager.qoder_distribution_settings().await;
    let dsh_config = engine_manager
        .get_engine_config(engine::EngineType::Dsh)
        .await;
    let mut async_delete_handles: Vec<(
        WorkspaceSessionMutationTarget,
        JoinHandle<Result<(), String>>,
    )> = Vec::new();

    for target in other_targets {
        match target.engine.as_str() {
            "claude" => {
                let workspace_path = target.owner_workspace_path.clone();
                let claude_config = claude_config.clone();
                let raw_id = target.native_session_id.clone();
                let handle = tokio::spawn(async move {
                    engine::claude_history::delete_claude_session_with_config(
                        &workspace_path,
                        &raw_id,
                        claude_config.as_ref(),
                    )
                    .await
                    .map(|_| ())
                });
                async_delete_handles.push((target, handle));
            }
            "gemini" => {
                let workspace_path = target.owner_workspace_path.clone();
                let gemini_home_dir = gemini_home_dir.clone();
                let raw_id = target.native_session_id.clone();
                let handle = tokio::spawn(async move {
                    engine::gemini_history::delete_gemini_session(
                        &workspace_path,
                        &raw_id,
                        gemini_home_dir.as_deref(),
                    )
                    .await
                });
                async_delete_handles.push((target, handle));
            }
            "kimi" => {
                let workspace_path = target.owner_workspace_path.clone();
                let kimi_home_dir = kimi_home_dir.clone();
                let raw_id = target.native_session_id.clone();
                let handle = tokio::spawn(async move {
                    engine::kimi_history::delete_kimi_session(
                        &workspace_path,
                        &raw_id,
                        kimi_home_dir.as_deref(),
                    )
                    .await
                });
                async_delete_handles.push((target, handle));
            }
            "grok" => {
                let workspace_path = target.owner_workspace_path.clone();
                let grok_home_dir = grok_home_dir.clone();
                let raw_id = target.native_session_id.clone();
                let handle = tokio::spawn(async move {
                    engine::grok_history::delete_grok_session(
                        &workspace_path,
                        &raw_id,
                        grok_home_dir.as_deref(),
                    )
                    .await
                });
                async_delete_handles.push((target, handle));
            }
            "pi" => {
                let workspace_path = target.owner_workspace_path.clone();
                let pi_home_dir = pi_home_dir.clone();
                let raw_id = target.native_session_id.clone();
                let handle = tokio::spawn(async move {
                    engine::pi_history::delete_pi_family_session(
                        engine::EngineType::Pi,
                        &workspace_path,
                        &raw_id,
                        pi_home_dir.as_deref(),
                    )
                    .await
                });
                async_delete_handles.push((target, handle));
            }
            "omp" => {
                let workspace_path = target.owner_workspace_path.clone();
                let omp_home_dir = omp_home_dir.clone();
                let raw_id = target.native_session_id.clone();
                let handle = tokio::spawn(async move {
                    engine::pi_history::delete_pi_family_session(
                        engine::EngineType::Omp,
                        &workspace_path,
                        &raw_id,
                        omp_home_dir.as_deref(),
                    )
                    .await
                });
                async_delete_handles.push((target, handle));
            }
            "qoder" => {
                let workspace_path = target.owner_workspace_path.clone();
                let workspace_id = target.owner_workspace_id.clone();
                let provider_profile_id = target.provider_profile_id.clone();
                let qoder_distribution_settings = qoder_distribution_settings.clone();
                let raw_id = target.native_session_id.clone();
                let handle = tokio::spawn(async move {
                    let launch_profile =
                        engine::qoder_provider_profile::resolve_qoder_provider_launch_profile(
                            &workspace_id,
                            provider_profile_id.as_deref(),
                            &qoder_distribution_settings,
                        )?;
                    engine::qoder_history::delete_qoder_session_for_launch_profile(
                        &workspace_path,
                        &raw_id,
                        &launch_profile,
                    )
                    .await
                });
                async_delete_handles.push((target, handle));
            }
            "dsh" => {
                let raw_id = target.native_session_id.clone();
                let dsh_config = dsh_config.clone();
                let handle = tokio::spawn(async move {
                    let runtime = crate::engine::dsh::runtime_settings_from_engine_config(
                        dsh_config.as_ref(),
                    );
                    let (_snapshot, client) =
                        crate::engine::dsh::connect_existing(&runtime).await?;
                    crate::engine::dsh::history::archive_dsh_session(&client, &raw_id).await
                });
                async_delete_handles.push((target, handle));
            }
            "opencode" => {
                let deletion = engine::commands::opencode_delete_session_core(
                    workspaces,
                    engine_manager,
                    &target.owner_workspace_id,
                    &target.native_session_id,
                )
                .await
                .map(|_| ());
                match deletion {
                    Ok(()) => {
                        metadata_cleanup_targets.push(target.clone());
                        results_by_session_id.insert(
                            target.requested_session_id.clone(),
                            batch_delete_success_for_target(&target),
                        );
                    }
                    Err(error) => {
                        if should_settle_delete_as_success(&error) {
                            metadata_cleanup_targets.push(target.clone());
                            results_by_session_id.insert(
                                target.requested_session_id.clone(),
                                batch_already_missing_cleaned_for_target(&target),
                            );
                        } else {
                            results_by_session_id.insert(
                                target.requested_session_id.clone(),
                                batch_error(
                                    target.requested_session_id,
                                    SESSION_DELETE_CODE_DELETE_FAILED,
                                    &error,
                                ),
                            );
                        }
                    }
                }
            }
            "shared" => {
                let thread_id = if target.requested_session_id.starts_with("shared:") {
                    target.requested_session_id.clone()
                } else {
                    format!("shared:{}", target.native_session_id)
                };
                match crate::shared_sessions::delete_shared_session_files(
                    &target.owner_workspace_id,
                    &thread_id,
                ) {
                    Ok(true) => {
                        metadata_cleanup_targets.push(target.clone());
                        results_by_session_id.insert(
                            target.requested_session_id.clone(),
                            batch_delete_success_for_target(&target),
                        );
                    }
                    Ok(false) => {
                        metadata_cleanup_targets.push(target.clone());
                        results_by_session_id.insert(
                            target.requested_session_id.clone(),
                            batch_already_missing_cleaned_for_target(&target),
                        );
                    }
                    Err(error) => {
                        results_by_session_id.insert(
                            target.requested_session_id.clone(),
                            batch_error(
                                target.requested_session_id,
                                SESSION_DELETE_CODE_DELETE_FAILED,
                                &error,
                            ),
                        );
                    }
                }
            }
            _ => {
                results_by_session_id.insert(
                    target.requested_session_id.clone(),
                    batch_error(
                        target.requested_session_id,
                        SESSION_DELETE_CODE_UNSUPPORTED,
                        "Session engine is not supported by delete management",
                    ),
                );
            }
        }
    }

    for (target, handle) in async_delete_handles {
        match handle.await {
            Ok(Ok(())) => {
                metadata_cleanup_targets.push(target.clone());
                results_by_session_id.insert(
                    target.requested_session_id.clone(),
                    batch_delete_success_for_target(&target),
                );
            }
            Ok(Err(error)) => {
                if should_settle_delete_as_success(&error) {
                    metadata_cleanup_targets.push(target.clone());
                    results_by_session_id.insert(
                        target.requested_session_id.clone(),
                        batch_already_missing_cleaned_for_target(&target),
                    );
                } else {
                    results_by_session_id.insert(
                        target.requested_session_id.clone(),
                        batch_error(
                            target.requested_session_id,
                            SESSION_DELETE_CODE_DELETE_FAILED,
                            &error,
                        ),
                    );
                }
            }
            Err(error) => {
                log::warn!(
                    "[session_management.delete_workspace_sessions] async delete task join error for workspace {}: {}",
                    workspace_id,
                    error
                );
                results_by_session_id.insert(
                    target.requested_session_id.clone(),
                    batch_error(
                        target.requested_session_id,
                        SESSION_DELETE_CODE_DELETE_FAILED,
                        "Async delete task join error",
                    ),
                );
            }
        }
    }

    // 统一删除绕过前端 fan-out，这里必须自己打 tombstone（含持久标记），
    // 否则重启后 sync/backfill 的 rescan 会把已删会话重新插回侧栏。
    if !metadata_cleanup_targets.is_empty() {
        let tombstone_ids: Vec<String> = metadata_cleanup_targets
            .iter()
            .map(|target| format!("{}:{}", target.engine, target.native_session_id))
            .collect();
        if let Err(error) =
            crate::session_index::commands::tombstone_session_index_rows(tombstone_ids).await
        {
            log::warn!(
                "[session_management.delete_workspace_sessions] tombstone session index failed for workspace {}: {}",
                workspace_id,
                error
            );
        }
    }
    if !metadata_cleanup_targets.is_empty() {
        let mut targets_by_owner = HashMap::<String, Vec<WorkspaceSessionMutationTarget>>::new();
        for target in metadata_cleanup_targets {
            targets_by_owner
                .entry(target.owner_workspace_id.clone())
                .or_default()
                .push(target);
        }
        for (owner_workspace_id, targets) in targets_by_owner {
            if let Err(error) =
                with_catalog_metadata_mutation(storage_path, &owner_workspace_id, |metadata| {
                    for target in &targets {
                        remove_catalog_metadata_for_target(metadata, target);
                    }
                    Ok(())
                })
            {
                let message = format!("failed to clean session metadata: {error}");
                for target in &targets {
                    results_by_session_id.insert(
                        target.requested_session_id.clone(),
                        batch_error_for_target(target, "DELETE_METADATA_CLEANUP_FAILED", &message),
                    );
                }
            }
        }
    }
    for session_id in ordered_session_ids {
        if let Some(result) = results_by_session_id.remove(&session_id) {
            results.push(result);
        }
    }
    let _ = sessions;
    Ok(WorkspaceSessionBatchMutationResponse { results })
}

fn batch_success_with_code(
    session_id: String,
    archived_at: Option<i64>,
    code: Option<&str>,
    deleted_from_disk: Option<bool>,
    metadata_cleaned: Option<bool>,
) -> WorkspaceSessionBatchMutationResult {
    WorkspaceSessionBatchMutationResult {
        session_id,
        stable_session_key: None,
        owner_workspace_id: None,
        ok: true,
        archived_at,
        error: None,
        code: code.map(ToString::to_string),
        deleted_from_disk,
        metadata_cleaned,
    }
}

pub(crate) fn batch_success_for_target(
    target: &WorkspaceSessionMutationTarget,
    archived_at: Option<i64>,
) -> WorkspaceSessionBatchMutationResult {
    WorkspaceSessionBatchMutationResult {
        session_id: target.requested_session_id.clone(),
        stable_session_key: Some(target.stable_session_key.clone()),
        owner_workspace_id: Some(target.owner_workspace_id.clone()),
        ok: true,
        archived_at,
        error: None,
        code: None,
        deleted_from_disk: None,
        metadata_cleaned: None,
    }
}

fn batch_delete_success_for_target(
    target: &WorkspaceSessionMutationTarget,
) -> WorkspaceSessionBatchMutationResult {
    let mut result = batch_delete_success(target.requested_session_id.clone());
    result.stable_session_key = Some(target.stable_session_key.clone());
    result.owner_workspace_id = Some(target.owner_workspace_id.clone());
    result
}

fn batch_already_missing_cleaned_for_target(
    target: &WorkspaceSessionMutationTarget,
) -> WorkspaceSessionBatchMutationResult {
    let mut result = batch_already_missing_cleaned(target.requested_session_id.clone());
    result.stable_session_key = Some(target.stable_session_key.clone());
    result.owner_workspace_id = Some(target.owner_workspace_id.clone());
    result
}

fn batch_delete_success(session_id: String) -> WorkspaceSessionBatchMutationResult {
    batch_success_with_code(
        session_id,
        None,
        Some(SESSION_DELETE_CODE_DELETED),
        Some(true),
        Some(true),
    )
}

fn batch_already_missing_cleaned(session_id: String) -> WorkspaceSessionBatchMutationResult {
    batch_success_with_code(
        session_id,
        None,
        Some(SESSION_DELETE_CODE_ALREADY_MISSING_CLEANED),
        Some(false),
        Some(true),
    )
}

pub(crate) fn batch_error(session_id: String, code: &str, error: &str) -> WorkspaceSessionBatchMutationResult {
    WorkspaceSessionBatchMutationResult {
        session_id,
        stable_session_key: None,
        owner_workspace_id: None,
        ok: false,
        archived_at: None,
        error: Some(error.to_string()),
        code: Some(code.to_string()),
        deleted_from_disk: None,
        metadata_cleaned: None,
    }
}

fn batch_error_for_target(
    target: &WorkspaceSessionMutationTarget,
    code: &str,
    error: &str,
) -> WorkspaceSessionBatchMutationResult {
    let mut result = batch_error(target.requested_session_id.clone(), code, error);
    result.stable_session_key = Some(target.stable_session_key.clone());
    result.owner_workspace_id = Some(target.owner_workspace_id.clone());
    result
}

pub(crate) fn replace_batch_results_for_targets(
    results: &mut [WorkspaceSessionBatchMutationResult],
    targets: &[WorkspaceSessionMutationTarget],
    code: &str,
    error: &str,
) {
    for target in targets {
        if let Some(result) = results.iter_mut().find(|result| {
            result.session_id == target.requested_session_id
                && result.stable_session_key.as_deref() == Some(target.stable_session_key.as_str())
        }) {
            *result = batch_error_for_target(target, code, error);
        }
    }
}

pub(crate) fn should_settle_delete_as_success(error: &str) -> bool {
    let normalized = error.trim().to_ascii_lowercase();
    if normalized.contains("invalid claude session id")
        || normalized.contains("invalid gemini session id")
        || normalized.contains("invalid opencode session id")
    {
        return false;
    }
    normalized.contains("session file not found")
        || normalized.contains("session not found")
        || normalized.contains("thread not found")
}

#[derive(Debug, Clone)]
pub(crate) struct WorkspaceSessionMutationTarget {
    pub(crate) requested_session_id: String,
    pub(crate) stable_session_key: String,
    pub(crate) metadata_lookup_keys: Vec<String>,
    pub(crate) owner_workspace_id: String,
    pub(crate) owner_workspace_path: PathBuf,
    pub(crate) native_session_id: String,
    pub(crate) engine: String,
    pub(crate) provider_profile_id: Option<String>,
    pub(crate) exists_on_disk: bool,
    pub(crate) delete_mode: Option<String>,
}

fn find_session_entry_in_workspace_scope<'a>(
    entries: &'a [WorkspaceSessionCatalogEntry],
    session_id: &str,
    session_engine: &str,
) -> Option<&'a WorkspaceSessionCatalogEntry> {
    entries.iter().find(|entry| {
        entry.engine.eq_ignore_ascii_case(session_engine)
            && entry.workspace_id != SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID
            && catalog_metadata_lookup_keys_for_entry(entry)
                .iter()
                .any(|key| key == session_id)
    })
}

pub(crate) fn resolve_session_mutation_target(
    entries: &[WorkspaceSessionCatalogEntry],
    workspaces: &HashMap<String, WorkspaceEntry>,
    session_id: &str,
) -> Option<WorkspaceSessionMutationTarget> {
    let identity = parse_catalog_identity(session_id);
    let session_engine = identity.engine_name();
    let entry = find_session_entry_in_workspace_scope(entries, session_id, session_engine)?;
    let owner_workspace = workspaces.get(&entry.workspace_id)?;
    let stable_session_key = entry
        .stable_session_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| build_catalog_entry_stable_key(entry));
    let metadata_lookup_keys = catalog_metadata_lookup_keys_for_entry(entry);
    let native_session_id = entry
        .canonical_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            parse_catalog_identity(&entry.session_id)
                .raw_session_id()
                .to_string()
        });

    Some(WorkspaceSessionMutationTarget {
        requested_session_id: session_id.to_string(),
        stable_session_key,
        metadata_lookup_keys,
        owner_workspace_id: entry.workspace_id.clone(),
        owner_workspace_path: PathBuf::from(&owner_workspace.path),
        native_session_id,
        engine: entry.engine.clone(),
        provider_profile_id: entry.provider_profile_id.clone(),
        exists_on_disk: entry.exists_on_disk,
        delete_mode: entry.delete_mode.clone(),
    })
}

pub(crate) fn unresolved_session_mutation_message(
    session_id: &str,
    entries: &[WorkspaceSessionCatalogEntry],
) -> String {
    let identity = parse_catalog_identity(session_id);
    if !identity.engine_name().eq_ignore_ascii_case("codex") {
        return "session does not belong to target workspace".to_string();
    }

    let raw_session_id = identity.raw_session_id();
    let has_provider_backed_hint = entries.iter().any(|entry| {
        entry.engine.eq_ignore_ascii_case("codex")
            && entry.provider_profile_id.is_some()
            && (entry
                .canonical_session_id
                .as_deref()
                .map(|value| value == raw_session_id)
                .unwrap_or(false)
                || entry.session_id == session_id
                || catalog_metadata_lookup_keys_for_entry(entry)
                    .iter()
                    .any(|key| key == session_id))
    });

    if has_provider_backed_hint {
        return "provider-backed Codex session target could not be resolved safely for this workspace"
            .to_string();
    }

    "Codex session target could not be resolved safely for this workspace; provider-home source may be incomplete or the session no longer belongs to this workspace".to_string()
}
