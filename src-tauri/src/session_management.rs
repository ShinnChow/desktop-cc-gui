use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::Mutex;

use crate::engine;
use crate::local_usage;
use crate::types::{WorkspaceEntry, WorkspaceSessionAttributionMode};

#[path = "session_management_archive_evidence.rs"]
mod session_management_archive_evidence;
#[path = "session_management_batch_assign.rs"]
mod session_management_batch_assign;
#[path = "session_management_catalog_helpers.rs"]
mod session_management_catalog_helpers;
#[path = "session_management_commands.rs"]
mod session_management_commands;
#[path = "session_management_delete_core.rs"]
mod session_management_delete_core;
#[path = "session_management_folder_core.rs"]
mod session_management_folder_core;
#[path = "session_management_folder_counts.rs"]
mod session_management_folder_counts;
#[path = "session_management_global_catalog.rs"]
mod session_management_global_catalog;
#[path = "session_management_metadata_keys.rs"]
mod session_management_metadata_keys;
#[path = "session_management_related.rs"]
mod session_management_related;
#[path = "session_management_types.rs"]
mod session_management_types;

pub(crate) use session_management_archive_evidence::list_workspace_session_archive_evidence_core;
pub(crate) use session_management_batch_assign::assign_workspace_session_folders_core;
// Glob re-export carries the #[tauri::command]-generated __cmd__* items consumed
// by the lib's command_registry; the daemon bin target does not reference them.
#[allow(unused_imports)]
pub(crate) use session_management_commands::*;
pub(crate) use session_management_delete_core::{
    batch_error, batch_success_for_target, delete_workspace_sessions_core,
    replace_batch_results_for_targets, resolve_session_mutation_target,
    should_settle_delete_as_success, unresolved_session_mutation_message, WorkspaceSessionMutationTarget,
};
pub(crate) use session_management_folder_core::{
    assign_workspace_session_folder_core, create_workspace_session_folder_core,
    delete_workspace_session_folder_core, list_workspace_session_folders_core,
    move_workspace_session_folder_core, record_auto_session_metadata_core,
    record_codex_provider_binding_core, record_engine_provider_binding_core,
    record_provider_continuation_metadata_core,
    rename_workspace_session_folder_core, schedule_engine_provider_binding_record,
};
pub(crate) use session_management_global_catalog::{
    apply_attribution_to_entry, build_claude_attribution_scopes,
    build_global_engine_catalog_entries, infer_related_attribution_for_workspace,
    resolve_catalog_entry_attribution,
};
pub(crate) use session_management_metadata_keys::{
    apply_children_counts, apply_codex_provider_home_binding_fallback,
    apply_strict_attribution_owner, archived_at_for_entry, archived_at_for_session,
    build_catalog_entry_dedupe_key, catalog_metadata_lookup_keys_for_entry,
    catalog_metadata_lookup_keys_for_session, catalog_metadata_path,
    engine_provider_binding_stable_key, ensure_workspace_exists, finalize_existing_catalog_entry,
    folder_assignment_keys_for_session, folder_exists, folder_subtree_ids,
    is_invalid_session_path_segment, is_stable_catalog_metadata_key,
    mark_entry_as_existing_on_disk, metadata_stable_key_for_session_id, normalize_folder_id,
    normalize_folder_name, normalize_optional_folder_id, normalize_session_ids,
    normalize_workspace_id, overlay_session_index_provider_bindings,
    provider_continuation_stable_key_for_session_id, provider_profile_id_for_session_at_path,
    push_orphan_entries_for_scope, read_catalog_metadata, read_catalog_metadata_for_scope,
    read_catalog_metadata_from_path, read_codex_provider_bindings,
    read_workspace_session_folder_assignments, remove_catalog_metadata_for_target,
    remove_folder_assignment_for_session, resolve_engine_provider_profile_id,
    resolve_provider_continuation_metadata, should_replace_global_entry,
    sort_workspace_session_folders, with_catalog_metadata_mutation, would_create_folder_cycle,
    write_catalog_metadata_unlocked,
};
#[cfg(test)]
pub(crate) use session_management_folder_core::record_engine_provider_binding_at_path;
#[cfg(test)]
pub(crate) use session_management_global_catalog::build_global_codex_catalog_entry;
#[cfg(test)]
pub(crate) use session_management_metadata_keys::{
    append_metadata_orphan_entries, apply_folder_assignment, auto_session_metadata_for_session,
    engine_provider_binding_for_session,
    folder_assignment_for_entry, normalize_legacy_qoder_catalog_metadata,
    remove_catalog_metadata_for_session,
};
pub(crate) use session_management_related::{
    force_codex_related_query, list_project_related_sessions_core,
};
pub(crate) use session_management_types::*;

#[cfg(test)]
use session_management_catalog_helpers::entry_matches_keyword;
use session_management_catalog_helpers::{
    build_catalog_count_summary, build_catalog_entry_stable_key, build_claude_source_fact_status,
    build_degraded_source_status, build_source_label, build_success_source_status,
    decorate_catalog_entry_for_response, entry_is_hidden_automatic_session,
    entry_matches_engine_and_keyword, entry_matches_query, entry_matches_status,
    normalize_source_statuses, source_fact_cache_dir, source_status_for_engine,
    unresolved_catalog_entry_to_diagnostic,
};
use session_management_folder_counts::{
    build_catalog_folder_count_summary, filter_catalog_entries_by_folder,
    normalize_query_folder_filter,
};

/// 出口过滤：catalog / projection / global 列表不得返回已 tombstone（用户
/// 已删除）的会话——物理残留文件 MUST NOT 经磁盘扫描源复活进侧栏。
/// 放在 core 出口而非 `build_workspace_scope_catalog_data` 内部：v1 删除的
/// owner 解析复用同一构建路径，tombstoned 行必须保持可解析以供重试。
pub(crate) fn reject_tombstoned_catalog_entries(entries: &mut Vec<WorkspaceSessionCatalogEntry>) {
    let filter = crate::session_index::tombstone_filter::TombstoneFilter::load_fail_open();
    if filter.is_empty() {
        return;
    }
    entries.retain(|entry| {
        !filter.is_tombstoned(&entry.engine, &entry.session_id)
            && entry
                .canonical_session_id
                .as_deref()
                .is_none_or(|canonical| !filter.is_tombstoned(&entry.engine, canonical))
    });
}

pub(crate) async fn list_workspace_sessions_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    _sessions: &Mutex<HashMap<String, std::sync::Arc<crate::codex::WorkspaceSession>>>,
    engine_manager: &engine::EngineManager,
    storage_path: &Path,
    workspace_id: String,
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    let normalized_query = query.unwrap_or_default();
    let attribution_mode = WorkspaceSessionAttributionMode::from_query(&normalized_query);
    let scan_mode = build_catalog_scan_mode(&normalized_query, cursor.as_deref(), limit);
    let mut scope_catalog = build_workspace_scope_catalog_data(
        workspaces,
        engine_manager,
        storage_path,
        &workspace_id,
        scan_mode,
        attribution_mode,
        normalized_query.scan_quality(),
    )
    .await?;
    reject_tombstoned_catalog_entries(&mut scope_catalog.entries);
    Ok(build_catalog_page(
        scope_catalog.entries,
        normalized_query,
        cursor,
        limit,
        join_partial_sources(scope_catalog.partial_sources),
        scope_catalog.source_statuses,
        scope_catalog.hidden_automatic_session_ids,
    ))
}

pub(crate) async fn get_workspace_session_projection_summary_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    engine_manager: &engine::EngineManager,
    storage_path: &Path,
    workspace_id: String,
    query: Option<WorkspaceSessionCatalogQuery>,
) -> Result<WorkspaceSessionProjectionSummary, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    let normalized_query = query.unwrap_or_default();
    let attribution_mode = WorkspaceSessionAttributionMode::from_query(&normalized_query);
    let scan_mode = build_catalog_scan_mode(
        &normalized_query,
        None,
        Some(SESSION_CATALOG_MAX_LIMIT as u32),
    );
    let mut scope_catalog = build_workspace_scope_catalog_data(
        workspaces,
        engine_manager,
        storage_path,
        &workspace_id,
        scan_mode,
        attribution_mode,
        normalized_query.scan_quality(),
    )
    .await?;
    reject_tombstoned_catalog_entries(&mut scope_catalog.entries);
    let counts = build_catalog_count_summary(&scope_catalog.entries, &normalized_query);
    let filtered_entries = scope_catalog
        .entries
        .iter()
        .filter(|entry| entry_matches_query(entry, &normalized_query))
        .collect::<Vec<_>>();
    let folder_counts = build_catalog_folder_count_summary(&filtered_entries);
    Ok(WorkspaceSessionProjectionSummary {
        scope_kind: scope_catalog.scope_kind,
        owner_workspace_ids: scope_catalog.owner_workspace_ids,
        active_total: counts.active_total,
        archived_total: counts.archived_total,
        all_total: counts.all_total,
        filtered_total: counts.filtered_total,
        folder_counts_by_id: folder_counts.folder_counts_by_id,
        unassigned_folder_count: folder_counts.unassigned_folder_count,
        partial_sources: scope_catalog.partial_sources,
        source_statuses: scope_catalog.source_statuses,
    })
}

pub(crate) async fn list_global_codex_sessions_core(
    engine_manager: &engine::EngineManager,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    let normalized_query = query.unwrap_or_default();
    let scan_mode = build_catalog_scan_mode(&normalized_query, cursor.as_deref(), limit);
    let (mut entries, partial_sources) = build_global_engine_catalog_entries(
        engine_manager,
        workspaces,
        storage_path,
        scan_mode,
        None,
        normalized_query.scan_quality(),
    )
    .await?;
    reject_tombstoned_catalog_entries(&mut entries);

    Ok(build_catalog_page(
        entries,
        normalized_query,
        cursor,
        limit,
        join_partial_sources(partial_sources),
        Vec::new(),
        Vec::new(),
    ))
}

async fn catalog_workspace_scope(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<Vec<WorkspaceEntry>, String> {
    let workspaces = workspaces.lock().await;
    let selected = workspaces
        .get(workspace_id)
        .cloned()
        .ok_or_else(|| "workspace not found".to_string())?;
    if selected.kind.is_worktree() {
        return Ok(vec![selected]);
    }

    let mut scoped = vec![selected.clone()];
    let mut children: Vec<WorkspaceEntry> = workspaces
        .values()
        .filter(|entry| entry.parent_id.as_deref() == Some(workspace_id))
        .cloned()
        .collect();
    children.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.id.cmp(&right.id))
    });
    scoped.extend(children);
    Ok(scoped)
}

pub(crate) fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as i64
}

fn join_partial_sources(partial_sources: Vec<String>) -> Option<String> {
    let deduped = normalize_partial_sources(partial_sources);
    if deduped.is_empty() {
        None
    } else {
        Some(deduped.join(","))
    }
}

fn normalize_partial_sources(partial_sources: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for partial_source in partial_sources {
        let normalized = partial_source.trim();
        if normalized.is_empty() {
            continue;
        }
        if seen.insert(normalized.to_string()) {
            deduped.push(normalized.to_string());
        }
    }
    deduped
}

include!("session_management_catalog_projection.rs");

#[cfg(test)]
mod tests {
    include!("session_management_test_support.rs");
    include!("session_management_tests.rs");
    include!("session_management_metadata_provider_tests.rs");
    include!("session_management_provider_binding_tests.rs");
    include!("session_management_provider_continuation_tests.rs");
    include!("session_management_folder_tests.rs");
    include!("session_management_folder_assignment_tests.rs");
    include!("session_management_archive_delete_tests.rs");
    include!("session_management_workspace_scope_tests.rs");
    include!("session_management_projection_tests.rs");
    include!("session_management_attribution_tests.rs");
}
