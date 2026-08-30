use serde::de::DeserializeOwned;
use serde_json::json;
use tauri::{AppHandle, State};

use super::{
    assign_workspace_session_folder_core, assign_workspace_session_folders_core,
    create_workspace_session_folder_core, delete_workspace_session_folder_core,
    delete_workspace_sessions_core, force_codex_related_query,
    get_workspace_session_projection_summary_core, list_global_codex_sessions_core,
    list_project_related_sessions_core, list_workspace_session_archive_evidence_core,
    list_workspace_session_folders_core, list_workspace_sessions_core,
    move_workspace_session_folder_core, record_auto_session_metadata_core,
    rename_workspace_session_folder_core, AutoSessionMetadata, WorkspaceSessionArchiveEvidence,
    WorkspaceSessionAssignmentResponse, WorkspaceSessionBatchMutationResponse,
    WorkspaceSessionCatalogPage, WorkspaceSessionCatalogQuery, WorkspaceSessionFolderMutation,
    WorkspaceSessionFolderTree, WorkspaceSessionProjectionSummary,
};
use crate::remote_backend;
use crate::state::AppState;

async fn forward_session_management_remote<T: DeserializeOwned>(
    state: &State<'_, AppState>,
    app: AppHandle,
    method: &str,
    params: serde_json::Value,
) -> Result<T, String> {
    let response = remote_backend::call_remote(state, app, method, params).await?;
    serde_json::from_value(response).map_err(|err| err.to_string())
}

async fn forward_session_management_remote_unit(
    state: &State<'_, AppState>,
    app: AppHandle,
    method: &str,
    params: serde_json::Value,
) -> Result<(), String> {
    let _: serde_json::Value =
        forward_session_management_remote(state, app, method, params).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_workspace_sessions(
    workspace_id: String,
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    list_workspace_sessions_core(
        &state.workspaces,
        &state.sessions,
        &state.engine_manager,
        state.storage_path.as_path(),
        workspace_id,
        query,
        cursor,
        limit,
    )
    .await
}

#[tauri::command]
pub(crate) async fn list_global_codex_sessions(
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    list_global_codex_sessions_core(
        &state.engine_manager,
        &state.workspaces,
        state.storage_path.as_path(),
        query,
        cursor,
        limit,
    )
    .await
}

#[tauri::command]
pub(crate) async fn list_project_related_codex_sessions(
    workspace_id: String,
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    list_project_related_sessions_core(
        &state.workspaces,
        &state.engine_manager,
        state.storage_path.as_path(),
        workspace_id,
        Some(force_codex_related_query(query)),
        cursor,
        limit,
    )
    .await
}

#[tauri::command]
pub(crate) async fn list_project_related_sessions(
    workspace_id: String,
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    list_project_related_sessions_core(
        &state.workspaces,
        &state.engine_manager,
        state.storage_path.as_path(),
        workspace_id,
        query,
        cursor,
        limit,
    )
    .await
}

#[tauri::command]
pub(crate) async fn list_workspace_session_archive_evidence(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionArchiveEvidence, String> {
    list_workspace_session_archive_evidence_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn record_auto_session_metadata(
    workspace_id: String,
    session_id: String,
    metadata: AutoSessionMetadata,
    state: State<'_, AppState>,
) -> Result<(), String> {
    record_auto_session_metadata_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id,
        session_id,
        metadata,
    )
    .await
}

#[tauri::command]
pub(crate) async fn get_workspace_session_projection_summary(
    workspace_id: String,
    query: Option<WorkspaceSessionCatalogQuery>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionProjectionSummary, String> {
    get_workspace_session_projection_summary_core(
        &state.workspaces,
        &state.engine_manager,
        state.storage_path.as_path(),
        workspace_id,
        query,
    )
    .await
}

#[tauri::command]
pub(crate) async fn delete_workspace_sessions(
    workspace_id: String,
    session_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    delete_workspace_sessions_core(
        &state.workspaces,
        &state.sessions,
        &state.engine_manager,
        state.storage_path.as_path(),
        workspace_id,
        session_ids,
    )
    .await
}

#[tauri::command]
pub(crate) async fn list_workspace_session_folders(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSessionFolderTree, String> {
    if remote_backend::is_remote_mode(&state).await {
        return forward_session_management_remote(
            &state,
            app,
            "list_workspace_session_folders",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    list_workspace_session_folders_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn create_workspace_session_folder(
    workspace_id: String,
    name: String,
    parent_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSessionFolderMutation, String> {
    if remote_backend::is_remote_mode(&state).await {
        return forward_session_management_remote(
            &state,
            app,
            "create_workspace_session_folder",
            json!({ "workspaceId": workspace_id, "name": name, "parentId": parent_id }),
        )
        .await;
    }

    create_workspace_session_folder_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id,
        name,
        parent_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn rename_workspace_session_folder(
    workspace_id: String,
    folder_id: String,
    name: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSessionFolderMutation, String> {
    if remote_backend::is_remote_mode(&state).await {
        return forward_session_management_remote(
            &state,
            app,
            "rename_workspace_session_folder",
            json!({ "workspaceId": workspace_id, "folderId": folder_id, "name": name }),
        )
        .await;
    }

    rename_workspace_session_folder_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id,
        folder_id,
        name,
    )
    .await
}

#[tauri::command]
pub(crate) async fn move_workspace_session_folder(
    workspace_id: String,
    folder_id: String,
    parent_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSessionFolderMutation, String> {
    if remote_backend::is_remote_mode(&state).await {
        return forward_session_management_remote(
            &state,
            app,
            "move_workspace_session_folder",
            json!({ "workspaceId": workspace_id, "folderId": folder_id, "parentId": parent_id }),
        )
        .await;
    }

    move_workspace_session_folder_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id,
        folder_id,
        parent_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn delete_workspace_session_folder(
    workspace_id: String,
    folder_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&state).await {
        return forward_session_management_remote_unit(
            &state,
            app,
            "delete_workspace_session_folder",
            json!({ "workspaceId": workspace_id, "folderId": folder_id }),
        )
        .await;
    }

    delete_workspace_session_folder_core(
        &state.workspaces,
        &state.engine_manager,
        state.storage_path.as_path(),
        workspace_id,
        folder_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn assign_workspace_session_folder(
    workspace_id: String,
    session_id: String,
    folder_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSessionAssignmentResponse, String> {
    if remote_backend::is_remote_mode(&state).await {
        return forward_session_management_remote(
            &state,
            app,
            "assign_workspace_session_folder",
            json!({ "workspaceId": workspace_id, "sessionId": session_id, "folderId": folder_id }),
        )
        .await;
    }

    assign_workspace_session_folder_core(
        &state.workspaces,
        &state.engine_manager,
        state.storage_path.as_path(),
        workspace_id,
        session_id,
        folder_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn assign_workspace_session_folders(
    workspace_id: String,
    session_ids: Vec<String>,
    folder_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    if remote_backend::is_remote_mode(&state).await {
        return forward_session_management_remote(
            &state,
            app,
            "assign_workspace_session_folders",
            json!({ "workspaceId": workspace_id, "sessionIds": session_ids, "folderId": folder_id }),
        )
        .await;
    }

    assign_workspace_session_folders_core(
        &state.workspaces,
        &state.engine_manager,
        state.storage_path.as_path(),
        workspace_id,
        session_ids,
        folder_id,
    )
    .await
}
