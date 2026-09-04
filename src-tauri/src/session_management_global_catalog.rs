use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use tokio::sync::Mutex;

use super::{
    apply_children_counts, apply_codex_provider_home_binding_fallback, apply_strict_attribution_owner,
    archived_at_for_entry, archived_at_for_session, build_shared_catalog_entry, build_source_label,
    finalize_existing_catalog_entry, mark_entry_as_existing_on_disk, normalize_partial_sources,
    read_catalog_metadata_for_scope, should_replace_global_entry, ProviderContinuationProjection,
    SessionCatalogAttribution, SessionCatalogAttributionConfidence, SessionCatalogAttributionReason,
    SessionCatalogAttributionStatus, SessionCatalogScanMode, WorkspaceSessionCatalogEntry,
    WorkspaceSessionCatalogMetadata, WorkspaceSessionScanQuality, SESSION_CATALOG_PARTIAL_CLAUDE,
    SESSION_CATALOG_PARTIAL_DSH, SESSION_CATALOG_PARTIAL_GEMINI, SESSION_CATALOG_PARTIAL_GROK,
    SESSION_CATALOG_PARTIAL_KIMI, SESSION_CATALOG_PARTIAL_SHARED,
    SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID, SESSION_DELETE_MODE_UNSUPPORTED,
};
use crate::engine;
use crate::local_usage;
use crate::types::WorkspaceEntry;

pub(crate) fn build_claude_attribution_scopes(
    workspace: &WorkspaceEntry,
) -> Vec<engine::claude_history::ClaudeSessionAttributionScope> {
    let mut scopes = Vec::new();
    let mut seen = HashSet::new();

    let workspace_path = PathBuf::from(&workspace.path);
    if seen.insert(workspace_path.to_string_lossy().to_string()) {
        scopes.push(
            engine::claude_history::ClaudeSessionAttributionScope::workspace_path(workspace_path),
        );
    }

    if let Some(git_root) = workspace
        .settings
        .git_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let git_root_path = PathBuf::from(git_root);
        if seen.insert(git_root_path.to_string_lossy().to_string()) {
            scopes.push(
                engine::claude_history::ClaudeSessionAttributionScope::git_root(git_root_path),
            );
        }
    }

    scopes
}

async fn build_global_codex_catalog_entries(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    scan_mode: SessionCatalogScanMode,
    scan_quality: WorkspaceSessionScanQuality,
) -> Result<Vec<WorkspaceSessionCatalogEntry>, String> {
    let global_summaries = match scan_quality {
        WorkspaceSessionScanQuality::Preview => {
            local_usage::list_global_codex_session_summaries_preview(workspaces, scan_mode.limit())
                .await?
        }
        WorkspaceSessionScanQuality::Full => {
            local_usage::list_global_codex_session_summaries(workspaces, scan_mode.limit()).await?
        }
    };
    let workspaces_snapshot = workspaces.lock().await.clone();
    let metadata_by_workspace_id = read_catalog_metadata_for_scope(
        storage_path,
        &workspaces_snapshot.values().cloned().collect::<Vec<_>>(),
    )?;

    let mut deduped = HashMap::<String, WorkspaceSessionCatalogEntry>::new();
    for summary in global_summaries {
        let entry = build_global_codex_catalog_entry(
            &summary,
            &workspaces_snapshot,
            &metadata_by_workspace_id,
        );
        let dedupe_key = format!("{}::{}", entry.engine, entry.session_id);
        match deduped.get(&dedupe_key) {
            Some(existing) if !should_replace_global_entry(existing, &entry) => {}
            _ => {
                deduped.insert(dedupe_key, entry);
            }
        }
    }
    let mut entries = deduped.into_values().collect::<Vec<_>>();
    apply_children_counts(&mut entries);

    Ok(entries)
}

pub(crate) async fn build_global_engine_catalog_entries(
    engine_manager: &engine::EngineManager,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    scan_mode: SessionCatalogScanMode,
    engine_filter: Option<&str>,
    scan_quality: WorkspaceSessionScanQuality,
) -> Result<(Vec<WorkspaceSessionCatalogEntry>, Vec<String>), String> {
    let include_engine = |engine: &str| engine_filter.is_none_or(|filter| filter == engine);
    let workspaces_snapshot = workspaces.lock().await.clone();
    let workspace_entries = workspaces_snapshot.values().cloned().collect::<Vec<_>>();
    let metadata_by_workspace_id =
        read_catalog_metadata_for_scope(storage_path, &workspace_entries)?;
    let shared_event_log_path = storage_path
        .parent()
        .map(|parent| parent.join("shared-event-log-v2.sqlite3"));
    let mut entries = if include_engine("codex") {
        build_global_codex_catalog_entries(workspaces, storage_path, scan_mode, scan_quality)
            .await?
    } else {
        Vec::new()
    };
    let mut partial_sources = Vec::new();
    let gemini_config = engine_manager
        .get_engine_config(engine::EngineType::Gemini)
        .await;
    let kimi_config = engine_manager
        .get_engine_config(engine::EngineType::Kimi)
        .await;
    let grok_config = engine_manager
        .get_engine_config(engine::EngineType::Grok)
        .await;
    let dsh_config = engine_manager
        .get_engine_config(engine::EngineType::Dsh)
        .await;
    let claude_config = engine_manager
        .get_engine_config(engine::EngineType::Claude)
        .await;

    for workspace in workspace_entries {
        let workspace_path = PathBuf::from(&workspace.path);
        if include_engine("claude") {
            match engine::claude_history::list_claude_sessions_for_attribution_scopes_with_config(
                &workspace_path,
                build_claude_attribution_scopes(&workspace),
                Some(scan_mode.limit()),
                claude_config.as_ref(),
            )
            .await
            {
                Ok(sessions) => {
                    for session in sessions {
                        let session_id = format!("claude:{}", session.session_id);
                        let archived_at =
                            metadata_by_workspace_id
                                .get(&workspace.id)
                                .and_then(|metadata| {
                                    archived_at_for_session(metadata, &workspace.id, &session_id)
                                });
                        let mut entry = WorkspaceSessionCatalogEntry {
                            session_id,
                            stable_session_key: None,
                            canonical_session_id: Some(session.session_id),
                            parent_session_id: session
                                .parent_session_id
                                .as_ref()
                                .map(|parent_session_id| format!("claude:{}", parent_session_id)),
                            workspace_id: workspace.id.clone(),
                            workspace_label: Some(workspace.name.clone()),
                            engine: "claude".to_string(),
                            title: session
                                .native_title
                                .clone()
                                .unwrap_or_else(|| session.first_message.clone()),
                            native_title: session.native_title,
                            updated_at: session.updated_at.max(0),
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
                            size_bytes: session.file_size_bytes,
                            cwd: session.cwd,
                            attribution_status: session.attribution_status.or_else(|| {
                                Some(
                                    SessionCatalogAttributionStatus::StrictMatch
                                        .as_str()
                                        .to_string(),
                                )
                            }),
                            attribution_reason: session.attribution_reason,
                            attribution_confidence: None,
                            matched_workspace_id: Some(workspace.id.clone()),
                            matched_workspace_label: Some(workspace.name.clone()),
                            folder_id: None,
                            auto_session: None,
                            exists_on_disk: false,
                            inconsistency_code: None,
                            delete_mode: None,
                            physical_path: None,
                            children_count: None,
                            continuation: ProviderContinuationProjection::default(),
                        };
                        entry = apply_strict_attribution_owner(
                            entry,
                            &workspaces_snapshot,
                            &metadata_by_workspace_id,
                        );
                        entries.push(finalize_existing_catalog_entry(
                            entry,
                            &metadata_by_workspace_id,
                        ));
                    }
                }
                Err(error) => {
                    log::warn!(
                    "[session_management.list_global_codex_sessions] claude history unavailable for workspace {}: {}",
                    workspace.id,
                    error
                );
                    partial_sources.push(SESSION_CATALOG_PARTIAL_CLAUDE.to_string());
                }
            }
        }

        if include_engine("gemini") {
            match engine::gemini_history::list_gemini_sessions(
                &workspace_path,
                Some(scan_mode.limit()),
                gemini_config
                    .as_ref()
                    .and_then(|item| item.home_dir.as_deref()),
            )
            .await
            {
                Ok(sessions) => {
                    for session in sessions {
                        let session_id = format!("gemini:{}", session.session_id);
                        let archived_at =
                            metadata_by_workspace_id
                                .get(&workspace.id)
                                .and_then(|metadata| {
                                    archived_at_for_session(metadata, &workspace.id, &session_id)
                                });
                        let entry = WorkspaceSessionCatalogEntry {
                            session_id,
                            stable_session_key: None,
                            canonical_session_id: session.canonical_session_id,
                            parent_session_id: None,
                            workspace_id: workspace.id.clone(),
                            workspace_label: Some(workspace.name.clone()),
                            engine: session.engine.unwrap_or_else(|| "gemini".to_string()),
                            title: session.first_message,
                            native_title: None,
                            updated_at: session.updated_at.max(0),
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
                            size_bytes: session.file_size_bytes,
                            cwd: None,
                            attribution_status: session.attribution_status.or_else(|| {
                                Some(
                                    SessionCatalogAttributionStatus::StrictMatch
                                        .as_str()
                                        .to_string(),
                                )
                            }),
                            attribution_reason: None,
                            attribution_confidence: None,
                            matched_workspace_id: Some(workspace.id.clone()),
                            matched_workspace_label: Some(workspace.name.clone()),
                            folder_id: None,
                            auto_session: None,
                            exists_on_disk: false,
                            inconsistency_code: None,
                            delete_mode: None,
                            physical_path: None,
                            children_count: None,
                            continuation: ProviderContinuationProjection::default(),
                        };
                        entries.push(finalize_existing_catalog_entry(
                            entry,
                            &metadata_by_workspace_id,
                        ));
                    }
                }
                Err(error) => {
                    log::warn!(
                    "[session_management.list_global_codex_sessions] gemini history unavailable for workspace {}: {}",
                    workspace.id,
                    error
                );
                    partial_sources.push(SESSION_CATALOG_PARTIAL_GEMINI.to_string());
                }
            }
        }

        if include_engine("kimi") {
            match engine::kimi_history::list_kimi_sessions(
                &workspace_path,
                Some(scan_mode.limit()),
                kimi_config
                    .as_ref()
                    .and_then(|item| item.home_dir.as_deref()),
            )
            .await
            {
                Ok(sessions) => {
                    for session in sessions {
                        let session_id = format!("kimi:{}", session.session_id);
                        let archived_at =
                            metadata_by_workspace_id
                                .get(&workspace.id)
                                .and_then(|metadata| {
                                    archived_at_for_session(metadata, &workspace.id, &session_id)
                                });
                        let entry = WorkspaceSessionCatalogEntry {
                            session_id,
                            stable_session_key: None,
                            canonical_session_id: session.canonical_session_id,
                            parent_session_id: None,
                            workspace_id: workspace.id.clone(),
                            workspace_label: Some(workspace.name.clone()),
                            engine: session.engine.unwrap_or_else(|| "kimi".to_string()),
                            title: session.first_message,
                            native_title: None,
                            updated_at: session.updated_at.max(0),
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
                            size_bytes: session.file_size_bytes,
                            cwd: None,
                            attribution_status: session.attribution_status.or_else(|| {
                                Some(
                                    SessionCatalogAttributionStatus::StrictMatch
                                        .as_str()
                                        .to_string(),
                                )
                            }),
                            attribution_reason: None,
                            attribution_confidence: None,
                            matched_workspace_id: Some(workspace.id.clone()),
                            matched_workspace_label: Some(workspace.name.clone()),
                            folder_id: None,
                            auto_session: None,
                            exists_on_disk: false,
                            inconsistency_code: None,
                            delete_mode: None,
                            physical_path: None,
                            children_count: None,
                            continuation: ProviderContinuationProjection::default(),
                        };
                        entries.push(finalize_existing_catalog_entry(
                            entry,
                            &metadata_by_workspace_id,
                        ));
                    }
                }
                Err(error) => {
                    log::warn!(
                    "[session_management.list_global_codex_sessions] kimi history unavailable for workspace {}: {}",
                    workspace.id,
                    error
                );
                    partial_sources.push(SESSION_CATALOG_PARTIAL_KIMI.to_string());
                }
            }
        }

        if include_engine("grok") {
            match engine::grok_history::list_grok_sessions(
                &workspace_path,
                Some(scan_mode.limit()),
                grok_config
                    .as_ref()
                    .and_then(|item| item.home_dir.as_deref()),
            )
            .await
            {
                Ok(sessions) => {
                    for session in sessions {
                        let session_id = format!("grok:{}", session.session_id);
                        let archived_at =
                            metadata_by_workspace_id
                                .get(&workspace.id)
                                .and_then(|metadata| {
                                    archived_at_for_session(metadata, &workspace.id, &session_id)
                                });
                        let entry = WorkspaceSessionCatalogEntry {
                            session_id,
                            stable_session_key: None,
                            canonical_session_id: session.canonical_session_id,
                            parent_session_id: None,
                            workspace_id: workspace.id.clone(),
                            workspace_label: Some(workspace.name.clone()),
                            engine: session.engine.unwrap_or_else(|| "grok".to_string()),
                            title: session.first_message,
                            native_title: None,
                            updated_at: session.updated_at.max(0),
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
                            size_bytes: session.file_size_bytes,
                            cwd: None,
                            attribution_status: session.attribution_status.or_else(|| {
                                Some(
                                    SessionCatalogAttributionStatus::StrictMatch
                                        .as_str()
                                        .to_string(),
                                )
                            }),
                            attribution_reason: None,
                            attribution_confidence: None,
                            matched_workspace_id: Some(workspace.id.clone()),
                            matched_workspace_label: Some(workspace.name.clone()),
                            folder_id: None,
                            auto_session: None,
                            exists_on_disk: false,
                            inconsistency_code: None,
                            delete_mode: None,
                            physical_path: None,
                            children_count: None,
                            continuation: ProviderContinuationProjection::default(),
                        };
                        entries.push(finalize_existing_catalog_entry(
                            entry,
                            &metadata_by_workspace_id,
                        ));
                    }
                }
                Err(error) => {
                    log::warn!(
                    "[session_management.list_global_codex_sessions] grok history unavailable for workspace {}: {}",
                    workspace.id,
                    error
                );
                    partial_sources.push(SESSION_CATALOG_PARTIAL_GROK.to_string());
                }
            }
        }

        if include_engine("dsh") {
            let runtime =
                crate::engine::dsh::runtime_settings_from_engine_config(dsh_config.as_ref());
            match async {
                let (_snapshot, client) = crate::engine::dsh::connect_existing(&runtime).await?;
                crate::engine::dsh::history::list_dsh_sessions(
                    &client,
                    &workspace_path,
                    Some(scan_mode.limit()),
                )
                .await
            }
            .await
            {
                Ok(sessions) => {
                    for session in sessions {
                        let session_id = format!("dsh:{}", session.session_id);
                        let archived_at =
                            metadata_by_workspace_id
                                .get(&workspace.id)
                                .and_then(|metadata| {
                                    archived_at_for_session(metadata, &workspace.id, &session_id)
                                });
                        let entry = WorkspaceSessionCatalogEntry {
                            session_id,
                            stable_session_key: None,
                            canonical_session_id: session.canonical_session_id,
                            parent_session_id: None,
                            workspace_id: workspace.id.clone(),
                            workspace_label: Some(workspace.name.clone()),
                            engine: session.engine.unwrap_or_else(|| "dsh".to_string()),
                            title: session.first_message,
                            native_title: None,
                            updated_at: session.updated_at.max(0),
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
                            attribution_reason: None,
                            attribution_confidence: None,
                            matched_workspace_id: Some(workspace.id.clone()),
                            matched_workspace_label: Some(workspace.name.clone()),
                            folder_id: None,
                            auto_session: None,
                            exists_on_disk: false,
                            inconsistency_code: None,
                            delete_mode: None,
                            physical_path: None,
                            children_count: None,
                            continuation: ProviderContinuationProjection::default(),
                        };
                        entries.push(finalize_existing_catalog_entry(
                            entry,
                            &metadata_by_workspace_id,
                        ));
                    }
                }
                Err(error) => {
                    log::warn!(
                    "[session_management.list_global_codex_sessions] dsh history unavailable for workspace {}: {}",
                    workspace.id,
                    error
                );
                    partial_sources.push(SESSION_CATALOG_PARTIAL_DSH.to_string());
                }
            }
        }

        if include_engine("shared") {
            match crate::shared_sessions::list_workspace_shared_sessions(
                &workspace.id,
                None,
                shared_event_log_path.as_deref(),
            ) {
                Ok(shared_sessions) => {
                    let owner_metadata = metadata_by_workspace_id
                        .get(&workspace.id)
                        .cloned()
                        .unwrap_or_default();
                    for summary in shared_sessions {
                        entries.push(build_shared_catalog_entry(
                            summary,
                            &workspace,
                            &owner_metadata,
                            &metadata_by_workspace_id,
                        ));
                    }
                }
                Err(error) => {
                    log::warn!(
                        "[session_management.list_global_shared_sessions] shared history unavailable for workspace {}: {}",
                        workspace.id,
                        error
                    );
                    partial_sources.push(SESSION_CATALOG_PARTIAL_SHARED.to_string());
                }
            }
        }
    }

    let mut deduped = HashMap::<String, WorkspaceSessionCatalogEntry>::new();
    for entry in entries {
        let dedupe_key = format!("{}::{}", entry.engine, entry.session_id);
        match deduped.get(&dedupe_key) {
            Some(existing) if !should_replace_global_entry(existing, &entry) => {}
            _ => {
                deduped.insert(dedupe_key, entry);
            }
        }
    }

    Ok((
        deduped.into_values().collect(),
        normalize_partial_sources(partial_sources),
    ))
}

pub(crate) fn build_global_codex_catalog_entry(
    summary: &crate::types::LocalUsageSessionSummary,
    workspaces_snapshot: &HashMap<String, WorkspaceEntry>,
    metadata_by_workspace_id: &HashMap<String, WorkspaceSessionCatalogMetadata>,
) -> WorkspaceSessionCatalogEntry {
    let source_label = build_source_label(summary.source.as_deref(), summary.provider.as_deref());
    let unresolved_entry = WorkspaceSessionCatalogEntry {
        session_id: summary.session_id.clone(),
        stable_session_key: None,
        canonical_session_id: Some(summary.session_id.clone()),
        parent_session_id: summary.parent_session_id.clone(),
        workspace_id: SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID.to_string(),
        workspace_label: None,
        engine: "codex".to_string(),
        title: summary
            .summary
            .clone()
            .unwrap_or_else(|| "Codex Session".to_string()),
        native_title: summary.native_title.clone(),
        updated_at: summary.timestamp.max(0),
        archived_at: None,
        thread_kind: "native".to_string(),
        source: summary.source.clone(),
        source_label,
        provider_profile_id: summary.provider_profile_id.clone(),
        provider_profile_source: summary.provider_profile_source.clone(),
        provider_profile_name: summary.provider_profile_name.clone(),
        provider_availability: summary.provider_availability.clone(),
        source_completeness: None,
        source_status_reason: None,
        size_bytes: summary.file_size_bytes,
        cwd: summary.cwd.clone(),
        attribution_status: None,
        attribution_reason: None,
        attribution_confidence: None,
        matched_workspace_id: None,
        matched_workspace_label: None,
        folder_id: None,
        auto_session: None,
        exists_on_disk: false,
        inconsistency_code: None,
        delete_mode: Some(SESSION_DELETE_MODE_UNSUPPORTED.to_string()),
        physical_path: summary.physical_path.clone(),
        children_count: None,
        continuation: ProviderContinuationProjection::default(),
    };
    let attribution = resolve_catalog_entry_attribution(workspaces_snapshot, &unresolved_entry);
    let mut entry = apply_attribution_to_entry(unresolved_entry, attribution);
    if let Some(owner_workspace_id) = entry.matched_workspace_id.clone() {
        if let Some(owner_workspace) = workspaces_snapshot.get(&owner_workspace_id) {
            entry.workspace_id = owner_workspace.id.clone();
            entry.workspace_label = Some(owner_workspace.name.clone());
            entry.archived_at = metadata_by_workspace_id
                .get(&owner_workspace.id)
                .and_then(|metadata| archived_at_for_entry(metadata, &entry));
        }
    }
    mark_entry_as_existing_on_disk(&mut entry);
    apply_codex_provider_home_binding_fallback(&mut entry);
    entry
}

pub(crate) fn apply_attribution_to_entry(
    mut entry: WorkspaceSessionCatalogEntry,
    attribution: SessionCatalogAttribution,
) -> WorkspaceSessionCatalogEntry {
    entry.attribution_status = Some(attribution.status.as_str().to_string());
    entry.attribution_reason = attribution.reason.map(|reason| reason.as_str().to_string());
    entry.attribution_confidence = attribution
        .confidence
        .map(|confidence| confidence.as_str().to_string());
    entry.matched_workspace_id = attribution.matched_workspace_id;
    entry.matched_workspace_label = attribution.matched_workspace_label;
    entry
}

pub(crate) fn resolve_catalog_entry_attribution(
    workspaces: &HashMap<String, WorkspaceEntry>,
    entry: &WorkspaceSessionCatalogEntry,
) -> SessionCatalogAttribution {
    if let Some(cwd) = entry.cwd.as_deref() {
        let exact_workspace_matches = workspaces
            .values()
            .filter(|workspace| paths_are_equivalent_for_owner(cwd, &workspace.path))
            .collect::<Vec<_>>();
        if let Some(workspace) = choose_longest_unique_workspace_match(exact_workspace_matches) {
            if claude_project_dir_owner_conflicts(entry, workspace, workspaces) {
                return unresolved_catalog_owner(
                    SessionCatalogAttributionReason::CwdProjectConflict,
                );
            }
            return SessionCatalogAttribution {
                status: SessionCatalogAttributionStatus::StrictMatch,
                reason: Some(SessionCatalogAttributionReason::CwdExact),
                confidence: Some(SessionCatalogAttributionConfidence::High),
                matched_workspace_id: Some(workspace.id.clone()),
                matched_workspace_label: Some(workspace.name.clone()),
            };
        }

        let matching_workspaces = workspaces
            .values()
            .filter(|workspace| {
                local_usage::path_matches_workspace(cwd, Path::new(&workspace.path))
            })
            .collect::<Vec<_>>();
        if let Some(workspace) = choose_longest_unique_workspace_match(matching_workspaces) {
            if claude_project_dir_owner_conflicts(entry, workspace, workspaces) {
                return unresolved_catalog_owner(
                    SessionCatalogAttributionReason::CwdProjectConflict,
                );
            }
            return SessionCatalogAttribution {
                status: SessionCatalogAttributionStatus::StrictMatch,
                reason: Some(SessionCatalogAttributionReason::CwdLongest),
                confidence: Some(SessionCatalogAttributionConfidence::High),
                matched_workspace_id: Some(workspace.id.clone()),
                matched_workspace_label: Some(workspace.name.clone()),
            };
        }

        let matching_git_root_workspaces = workspaces
            .values()
            .filter(|workspace| {
                workspace
                    .settings
                    .git_root
                    .as_deref()
                    .map(|git_root| local_usage::path_matches_workspace(cwd, Path::new(git_root)))
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        if let Some(workspace) = choose_longest_unique_workspace_match(matching_git_root_workspaces)
        {
            if claude_project_dir_owner_conflicts(entry, workspace, workspaces) {
                return unresolved_catalog_owner(
                    SessionCatalogAttributionReason::CwdProjectConflict,
                );
            }
            return SessionCatalogAttribution {
                status: SessionCatalogAttributionStatus::StrictMatch,
                reason: Some(SessionCatalogAttributionReason::GitRootInferred),
                confidence: Some(SessionCatalogAttributionConfidence::High),
                matched_workspace_id: Some(workspace.id.clone()),
                matched_workspace_label: Some(workspace.name.clone()),
            };
        }

        return unresolved_catalog_owner(SessionCatalogAttributionReason::AmbiguousSibling);
    }

    if entry.engine.eq_ignore_ascii_case("claude")
        && entry.attribution_reason.as_deref()
            == Some(engine::claude_history::CLAUDE_ATTRIBUTION_REASON_PROJECT_DIRECTORY)
    {
        if let Some(workspace) = workspaces.get(&entry.workspace_id) {
            return SessionCatalogAttribution {
                status: SessionCatalogAttributionStatus::StrictMatch,
                reason: Some(SessionCatalogAttributionReason::ProjectDirDirect),
                confidence: Some(SessionCatalogAttributionConfidence::Medium),
                matched_workspace_id: Some(workspace.id.clone()),
                matched_workspace_label: Some(workspace.name.clone()),
            };
        }
    }

    unresolved_catalog_owner(SessionCatalogAttributionReason::SourceIncomplete)
}

fn unresolved_catalog_owner(reason: SessionCatalogAttributionReason) -> SessionCatalogAttribution {
    SessionCatalogAttribution {
        status: SessionCatalogAttributionStatus::Unassigned,
        reason: Some(reason),
        confidence: Some(SessionCatalogAttributionConfidence::Low),
        matched_workspace_id: None,
        matched_workspace_label: None,
    }
}

fn claude_project_dir_owner_conflicts(
    entry: &WorkspaceSessionCatalogEntry,
    matched_workspace: &WorkspaceEntry,
    workspaces: &HashMap<String, WorkspaceEntry>,
) -> bool {
    if !entry.engine.eq_ignore_ascii_case("claude")
        || entry.attribution_reason.as_deref()
            != Some(engine::claude_history::CLAUDE_ATTRIBUTION_REASON_PROJECT_DIRECTORY)
        || entry.workspace_id == matched_workspace.id
    {
        return false;
    }

    workspaces
        .get(&entry.workspace_id)
        .map(|project_dir_workspace| {
            !is_same_workspace_family(project_dir_workspace, matched_workspace)
        })
        .unwrap_or(false)
}

fn normalize_owner_path_for_exact_match(path: &str) -> String {
    path.trim().trim_end_matches(['/', '\\']).to_string()
}

fn paths_are_equivalent_for_owner(left: &str, right: &str) -> bool {
    let left = normalize_owner_path_for_exact_match(left);
    let right = normalize_owner_path_for_exact_match(right);
    !left.is_empty() && left == right
}

fn choose_longest_unique_workspace_match(matches: Vec<&WorkspaceEntry>) -> Option<&WorkspaceEntry> {
    let max_len = matches.iter().map(|workspace| workspace.path.len()).max()?;
    let mut longest = matches
        .into_iter()
        .filter(|workspace| workspace.path.len() == max_len)
        .collect::<Vec<_>>();
    if longest.len() == 1 {
        longest.pop()
    } else {
        None
    }
}

pub(crate) fn infer_related_attribution_for_workspace(
    workspaces: &HashMap<String, WorkspaceEntry>,
    selected_workspace: &WorkspaceEntry,
    entry: &WorkspaceSessionCatalogEntry,
) -> Option<SessionCatalogAttribution> {
    let entry_cwd = entry.cwd.as_deref();
    let owner_workspace = workspaces.get(&entry.workspace_id);
    if let Some(owner_workspace) = owner_workspace {
        if is_same_workspace_family(selected_workspace, owner_workspace) {
            return Some(SessionCatalogAttribution {
                status: SessionCatalogAttributionStatus::InferredRelated,
                reason: Some(SessionCatalogAttributionReason::SharedWorktreeFamily),
                confidence: Some(SessionCatalogAttributionConfidence::High),
                matched_workspace_id: Some(selected_workspace.id.clone()),
                matched_workspace_label: Some(selected_workspace.name.clone()),
            });
        }
    }

    let cwd = entry_cwd?;
    if selected_workspace.kind.is_worktree() {
        if let Some(parent_workspace) = selected_workspace
            .parent_id
            .as_ref()
            .and_then(|parent_id| workspaces.get(parent_id))
        {
            if local_usage::path_matches_workspace(cwd, Path::new(&parent_workspace.path)) {
                let family_candidates = workspaces
                    .values()
                    .filter(|candidate| {
                        candidate.parent_id.as_deref() == Some(parent_workspace.id.as_str())
                    })
                    .count();
                if family_candidates <= 1 {
                    return Some(SessionCatalogAttribution {
                        status: SessionCatalogAttributionStatus::InferredRelated,
                        reason: Some(SessionCatalogAttributionReason::ParentScope),
                        confidence: Some(SessionCatalogAttributionConfidence::Medium),
                        matched_workspace_id: Some(selected_workspace.id.clone()),
                        matched_workspace_label: Some(selected_workspace.name.clone()),
                    });
                }
            }
        }
    }

    let selected_git_root = selected_workspace.settings.git_root.as_deref()?;
    if !local_usage::path_matches_workspace(cwd, Path::new(selected_git_root)) {
        return None;
    }
    let matching_git_root_families = workspaces
        .values()
        .filter(|candidate| {
            candidate
                .settings
                .git_root
                .as_deref()
                .map(|git_root| local_usage::path_matches_workspace(cwd, Path::new(git_root)))
                .unwrap_or(false)
        })
        .map(workspace_family_key)
        .collect::<HashSet<_>>();
    if matching_git_root_families.len() != 1
        || !matching_git_root_families.contains(&workspace_family_key(selected_workspace))
    {
        return None;
    }

    Some(SessionCatalogAttribution {
        status: SessionCatalogAttributionStatus::InferredRelated,
        reason: Some(SessionCatalogAttributionReason::SharedGitRoot),
        confidence: Some(SessionCatalogAttributionConfidence::Medium),
        matched_workspace_id: Some(selected_workspace.id.clone()),
        matched_workspace_label: Some(selected_workspace.name.clone()),
    })
}

fn workspace_family_key(workspace: &WorkspaceEntry) -> String {
    if workspace.kind.is_worktree() {
        workspace
            .parent_id
            .clone()
            .unwrap_or_else(|| workspace.id.clone())
    } else {
        workspace.id.clone()
    }
}

fn is_same_workspace_family(left: &WorkspaceEntry, right: &WorkspaceEntry) -> bool {
    workspace_family_key(left) == workspace_family_key(right)
}
