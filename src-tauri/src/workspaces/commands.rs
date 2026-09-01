use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager, State};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use super::external_changes::{
    clear_detached_external_change_monitor_inner, configure_detached_external_change_monitor_inner,
    DetachedExternalMonitorStatus,
};
use super::files::{
    copy_workspace_item_inner, create_workspace_directory_inner, duplicate_workspace_item_inner,
    list_external_absolute_directory_children_inner, list_external_spec_tree_inner,
    list_workspace_directory_children_inner_with_refresh, list_workspace_files_inner_with_refresh,
    paste_external_workspace_items_inner, paste_workspace_item_inner,
    read_external_absolute_file_inner, read_external_spec_file_inner, read_workspace_file_inner,
    read_workspace_file_preview_inner, read_workspace_file_tail_inner, rename_workspace_item_inner,
    resolve_external_absolute_preview_handle_inner, resolve_external_spec_preview_handle_inner,
    resolve_workspace_preview_handle_inner, search_workspace_text_inner,
    trash_workspace_item_inner, write_external_absolute_file_inner, write_external_spec_file_inner,
    write_workspace_file_inner, ExternalSpecFileResponse, WorkspaceFileOperationResult,
    WorkspaceFileResponse, WorkspaceFilesResponse, WorkspacePreviewHandleResponse,
    WorkspaceTextSearchOptions, WorkspaceTextSearchResponse,
};
use super::git::{
    git_branch_exists, git_find_remote_for_branch, git_get_origin_url, git_remote_branch_exists,
    git_remote_exists, is_missing_worktree_error, run_git_command, run_git_command_bytes,
    run_git_command_owned, run_git_diff, unique_branch_name,
};
#[cfg(target_os = "macos")]
use super::macos::get_open_app_icon_inner;
use super::open_app::*;
use super::settings::apply_workspace_settings_update;
use super::worktree::{
    build_clone_destination_path, null_device_path, sanitize_worktree_name, unique_worktree_path,
    unique_worktree_path_for_rename,
};

use crate::app_paths;
use crate::backend::app_server::WorkspaceSession;
use crate::codex::args::resolve_workspace_codex_args;
use crate::codex::home::{resolve_default_codex_home, resolve_workspace_codex_home};
use crate::codex::spawn_workspace_session;
use crate::engine::{detection_disabled_engines, resolve_engine_type, EngineType};
use crate::git_utils::resolve_git_root;
use crate::remote_backend;
use crate::shared::settings_core::{take_workspaces_recovery_notice_core, WorkspacesRecoveryNotice};
use crate::shared::workspaces_core;
use crate::state::AppState;
use crate::storage::write_workspaces_preserving_existing;
use crate::types::{
    WorkspaceEntry, WorkspaceInfo, WorkspaceKind, WorkspaceSettings, WorktreeSetupStatus,
};
use crate::utils::{git_env_path, resolve_git_binary};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceCommandResult {
    pub(crate) command: Vec<String>,
    pub(crate) exit_code: i32,
    pub(crate) success: bool,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

fn app_data_dir_for_state(state: &AppState) -> Result<PathBuf, String> {
    state
        .settings_path
        .parent()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| "Unable to resolve app data dir.".to_string())
}

fn allowed_external_skill_roots(
    state: &AppState,
    workspaces: &std::collections::HashMap<String, WorkspaceEntry>,
    workspace_id: &str,
    custom_skill_roots: &[PathBuf],
) -> Result<Vec<PathBuf>, String> {
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| format!("Workspace not found: {workspace_id}"))?;
    let parent_entry = entry
        .parent_id
        .as_ref()
        .and_then(|parent_id| workspaces.get(parent_id));

    let mut roots = vec![
        app_data_dir_for_state(state)?
            .join("workspaces")
            .join(&entry.id)
            .join("skills"),
        PathBuf::from(&entry.path).join(".claude").join("skills"),
        PathBuf::from(&entry.path).join(".codex").join("skills"),
        PathBuf::from(&entry.path).join(".gemini").join("skills"),
        PathBuf::from(&entry.path).join(".agents").join("skills"),
    ];

    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".claude").join("skills"));
        roots.push(home.join(".gemini").join("skills"));
        roots.push(home.join(".agents").join("skills"));
    }

    if let Some(codex_home) =
        resolve_workspace_codex_home(entry, parent_entry).or_else(resolve_default_codex_home)
    {
        roots.push(codex_home.join("skills"));
    }
    roots.extend(custom_skill_roots.iter().cloned());

    roots.sort();
    roots.dedup();
    Ok(roots)
}

fn allowed_external_project_map_roots(entry: &WorkspaceEntry) -> Result<Vec<PathBuf>, String> {
    let mut roots = vec![
        app_paths::app_home_dir()?.join("project-map"),
        PathBuf::from(&entry.path)
            .join(".ccgui")
            .join("project-map"),
    ];
    roots.sort();
    roots.dedup();
    Ok(roots)
}

fn allowed_external_absolute_read_roots(
    state: &AppState,
    workspaces: &std::collections::HashMap<String, WorkspaceEntry>,
    workspace_id: &str,
    custom_skill_roots: &[PathBuf],
) -> Result<Vec<PathBuf>, String> {
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| format!("Workspace not found: {workspace_id}"))?;
    let mut roots =
        allowed_external_skill_roots(state, workspaces, workspace_id, custom_skill_roots)?;
    roots.extend(allowed_external_project_map_roots(entry)?);
    roots.sort();
    roots.dedup();
    Ok(roots)
}

fn normalize_custom_spec_root(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Custom spec root cannot be empty.".to_string());
    }
    let raw = PathBuf::from(trimmed);
    if !raw.is_absolute() {
        return Err("Custom spec root must be an absolute path.".to_string());
    }
    let canonical = raw
        .canonicalize()
        .map_err(|err| format!("Failed to resolve custom spec root: {err}"))?;
    if !canonical.is_dir() {
        return Err("Custom spec root is not a directory.".to_string());
    }
    Ok(canonical)
}

fn resolve_effective_spec_root(custom_root: &Path) -> Result<PathBuf, String> {
    let file_name = custom_root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if file_name.eq_ignore_ascii_case("openspec") {
        return Ok(custom_root.to_path_buf());
    }

    let nested = custom_root.join("openspec");
    if nested.is_dir() {
        return nested
            .canonicalize()
            .map_err(|err| format!("Failed to resolve custom spec root: {err}"));
    }

    // Backward compatibility: older clients may pass openspec root directly
    // with non-standard directory names.
    let legacy_root = custom_root.join("changes").is_dir() && custom_root.join("specs").is_dir();
    if legacy_root {
        return Ok(custom_root.to_path_buf());
    }

    Ok(nested)
}

#[cfg(windows)]
fn normalize_windows_link_path(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('/', "\\");
    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{stripped}");
    }
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return stripped.to_string();
    }
    raw
}

#[cfg(windows)]
fn escape_windows_cmd_arg(value: &str) -> String {
    value.replace('"', "\\\"")
}

fn prepare_spec_command_workdir(
    workspace_root: &Path,
    custom_spec_root: Option<&str>,
) -> Result<(PathBuf, Option<PathBuf>), String> {
    let Some(root_input) = custom_spec_root else {
        return Ok((workspace_root.to_path_buf(), None));
    };
    let custom_root = normalize_custom_spec_root(root_input)?;
    let effective_spec_root = resolve_effective_spec_root(&custom_root)?;
    let file_name = effective_spec_root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if file_name.eq_ignore_ascii_case("openspec") {
        let parent = effective_spec_root
            .parent()
            .ok_or_else(|| "Custom spec root parent is invalid.".to_string())?;
        return Ok((parent.to_path_buf(), None));
    }

    let temp_dir = std::env::temp_dir().join(format!("spec-hub-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|err| format!("Failed to create temporary spec workspace: {err}"))?;
    let link_target = temp_dir.join("openspec");

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&effective_spec_root, &link_target)
            .map_err(|err| format!("Failed to prepare temporary spec symlink workspace: {err}"))?;
    }
    #[cfg(windows)]
    {
        if std::os::windows::fs::symlink_dir(&effective_spec_root, &link_target).is_err() {
            let link_target_path = normalize_windows_link_path(&link_target);
            let custom_root_path = normalize_windows_link_path(&effective_spec_root);
            let target_arg = escape_windows_cmd_arg(&link_target_path);
            let source_arg = escape_windows_cmd_arg(&custom_root_path);
            let is_unc_root = custom_root_path.starts_with(r"\\");
            let mut attempts: Vec<String> = Vec::new();
            if is_unc_root {
                attempts.push(format!(r#"mklink /D "{}" "{}""#, target_arg, source_arg));
            } else {
                attempts.push(format!(r#"mklink /J "{}" "{}""#, target_arg, source_arg));
                attempts.push(format!(r#"mklink /D "{}" "{}""#, target_arg, source_arg));
            }

            let mut last_error = String::new();
            let mut linked = false;
            for attempt in attempts {
                let output = crate::utils::std_command("cmd")
                    .arg("/C")
                    .arg(&attempt)
                    .output()
                    .map_err(|err| format!("Failed to create Windows spec link: {err}"))?;
                if output.status.success() {
                    linked = true;
                    break;
                }
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if !stderr.is_empty() {
                    last_error = stderr;
                }
            }

            if !linked {
                return Err(if last_error.is_empty() {
                    "Failed to prepare temporary spec workspace alias on Windows.".to_string()
                } else {
                    format!(
                        "Failed to prepare temporary spec workspace alias on Windows: {last_error}"
                    )
                });
            }
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        return Err("Custom spec root alias is not supported on this platform.".to_string());
    }

    Ok((temp_dir.clone(), Some(temp_dir)))
}

fn cleanup_spec_command_workdir(path: &Path) {
    #[cfg(windows)]
    {
        // For junction/symlink targets, remove the alias entry first to avoid traversing target content.
        let link_target = path.join("openspec");
        let link_exists = std::fs::symlink_metadata(&link_target).is_ok();
        if link_exists {
            let removed = std::fs::remove_dir(&link_target)
                .or_else(|_| std::fs::remove_file(&link_target))
                .is_ok();
            if !removed {
                // Keep temporary directory if alias cleanup failed, avoiding any chance of traversing target data.
                return;
            }
        }
        let _ = std::fs::remove_dir_all(path).or_else(|_| std::fs::remove_dir(path));
    }
    #[cfg(not(windows))]
    {
        let _ = std::fs::remove_dir_all(path);
    }
}

fn normalize_image_local_path(raw_path: &str) -> Option<PathBuf> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut decoded = trimmed.to_string();
    if let Some(rest) = decoded.strip_prefix("file://localhost/") {
        decoded = format!("/{rest}");
    } else if let Some(rest) = decoded.strip_prefix("file://") {
        decoded = if rest.starts_with('/') {
            rest.to_string()
        } else {
            format!("/{rest}")
        };
    }
    #[cfg(windows)]
    {
        if decoded.starts_with('/') && decoded.len() >= 3 {
            let bytes = decoded.as_bytes();
            if bytes[2] == b':' && bytes[1].is_ascii_alphabetic() {
                decoded = decoded[1..].to_string();
            }
        }
    }
    Some(PathBuf::from(decoded))
}

const MAX_INLINE_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

fn is_supported_image_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("png")
            | Some("jpg")
            | Some("jpeg")
            | Some("gif")
            | Some("webp")
            | Some("bmp")
            | Some("tif")
            | Some("tiff")
            | Some("svg")
            | Some("ico")
            | Some("avif")
    )
}

fn is_path_under_allowed_roots(path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| path.starts_with(root))
}

async fn allowed_image_preview_roots(
    state: &AppState,
    workspace_id: &str,
) -> Result<Vec<PathBuf>, String> {
    let (workspace_path, parent_workspace_path) = {
        let workspaces = state.workspaces.lock().await;
        let entry = workspaces
            .get(workspace_id)
            .ok_or_else(|| format!("Workspace not found: {workspace_id}"))?;
        let parent = entry
            .parent_id
            .as_ref()
            .and_then(|parent_id| workspaces.get(parent_id))
            .map(|parent_entry| parent_entry.path.clone());
        (entry.path.clone(), parent)
    };

    let mut roots: Vec<PathBuf> = vec![PathBuf::from(workspace_path)];
    if let Some(parent_path) = parent_workspace_path {
        roots.push(PathBuf::from(parent_path));
    }
    roots.push(app_data_dir_for_state(state)?.join("workspaces"));
    roots.extend(app_paths::workspace_root_candidates()?);
    roots.push(app_paths::note_card_dir()?);
    // Grok CLI persists multimodal attachments under ~/.grok/sessions/.../assets/
    // (or $GROK_HOME/sessions/...). Allow preview of those saved images.
    if let Some(grok_home) = std::env::var_os("GROK_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".grok")))
    {
        roots.push(grok_home.join("sessions"));
    }

    let mut canonical_roots = roots
        .into_iter()
        .filter_map(|root| root.canonicalize().ok())
        .collect::<Vec<_>>();
    canonical_roots.sort();
    canonical_roots.dedup();
    Ok(canonical_roots)
}

fn image_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("tif") | Some("tiff") => "image/tiff",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("avif") => "image/avif",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
pub(crate) async fn read_local_image_data_url(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<String, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return Err("read_local_image_data_url is not supported in remote mode.".to_string());
    }
    let absolute_path =
        normalize_image_local_path(&path).ok_or_else(|| "Invalid image path.".to_string())?;
    if !absolute_path.is_absolute() {
        return Err("Image path must be absolute.".to_string());
    }
    let metadata = std::fs::metadata(&absolute_path)
        .map_err(|err| format!("Failed to stat image file: {err}"))?;
    if !metadata.is_file() {
        return Err("Target image path is not a file.".to_string());
    }
    if metadata.len() > MAX_INLINE_IMAGE_BYTES {
        return Err(format!(
            "Image file is too large to inline (max {} bytes).",
            MAX_INLINE_IMAGE_BYTES
        ));
    }
    if !is_supported_image_extension(&absolute_path) {
        return Err("Unsupported image file extension.".to_string());
    }
    let canonical_path = absolute_path
        .canonicalize()
        .map_err(|err| format!("Failed to resolve image path: {err}"))?;
    let allowed_roots = allowed_image_preview_roots(&state, &workspace_id).await?;
    if allowed_roots.is_empty() || !is_path_under_allowed_roots(&canonical_path, &allowed_roots) {
        return Err("Image path is outside allowed preview directories.".to_string());
    }
    let bytes = std::fs::read(&canonical_path)
        .map_err(|err| format!("Failed to read image file: {err}"))?;
    let mime = image_mime_type(&canonical_path);
    let encoded = STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[cfg(test)]
mod image_preview_policy_tests {
    use super::{
        allowed_external_project_map_roots, is_path_under_allowed_roots,
        is_supported_image_extension,
    };
    use crate::types::{WorkspaceEntry, WorkspaceKind, WorkspaceSettings};
    use std::path::PathBuf;
    use uuid::Uuid;

    #[test]
    fn supported_image_extension_is_restricted() {
        assert!(is_supported_image_extension(&PathBuf::from("/tmp/a.png")));
        assert!(is_supported_image_extension(&PathBuf::from("/tmp/a.jpeg")));
        assert!(!is_supported_image_extension(&PathBuf::from("/tmp/a.txt")));
        assert!(!is_supported_image_extension(&PathBuf::from("/tmp/a")));
    }

    #[test]
    fn path_must_be_under_allowed_roots() {
        let root = PathBuf::from("/tmp/allowed");
        let roots = vec![root.clone()];
        assert!(is_path_under_allowed_roots(&root.join("a.png"), &roots,));
        assert!(!is_path_under_allowed_roots(
            &PathBuf::from("/tmp/other/a.png"),
            &roots,
        ));
    }

    #[test]
    fn project_map_external_roots_are_derived_from_runtime_paths() {
        let workspace_path =
            std::env::temp_dir().join(format!("project-map-root-{}", Uuid::new_v4()));
        let workspace_project_map_root = workspace_path.join(".ccgui").join("project-map");
        let entry = WorkspaceEntry {
            id: "ws-project-map-roots".to_string(),
            name: "Project Map Roots".to_string(),
            path: workspace_path.to_string_lossy().to_string(),
            codex_bin: None,
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        };

        let roots = allowed_external_project_map_roots(&entry).expect("resolve roots");

        assert!(roots.contains(&workspace_project_map_root));
        assert!(roots
            .iter()
            .any(|root| root != &workspace_project_map_root && root.ends_with("project-map")));
    }
}

async fn run_command_with_cwd(
    command: Vec<String>,
    current_dir: &Path,
    timeout_ms: Option<u64>,
) -> Result<WorkspaceCommandResult, String> {
    if command.is_empty() {
        return Err("Command cannot be empty.".to_string());
    }
    if !current_dir.is_dir() {
        return Err("Execution directory is not a directory.".to_string());
    }

    let program = command[0].clone();
    let args: Vec<String> = command.iter().skip(1).cloned().collect();
    let timeout_duration = Duration::from_millis(timeout_ms.unwrap_or(120_000).min(600_000));

    let mut process = crate::utils::async_command(&program);
    process
        .args(&args)
        .current_dir(current_dir)
        .env("PATH", git_env_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let child = process
        .spawn()
        .map_err(|err| format!("Failed to run command: {err}"))?;

    let output = match tokio::time::timeout(timeout_duration, child.wait_with_output()).await {
        Ok(result) => result.map_err(|err| format!("Command execution failed: {err}"))?,
        Err(_) => {
            return Err(format!(
                "Command timed out after {}ms.",
                timeout_duration.as_millis()
            ))
        }
    };

    Ok(WorkspaceCommandResult {
        command,
        exit_code: output.status.code().unwrap_or(-1),
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

pub(crate) fn spawn_with_app(
    app: &AppHandle,
    entry: WorkspaceEntry,
    default_bin: Option<String>,
    codex_args: Option<String>,
    codex_home: Option<PathBuf>,
) -> impl std::future::Future<Output = Result<Arc<WorkspaceSession>, String>> {
    spawn_workspace_session(entry, default_bin, codex_args, app.clone(), codex_home)
}

async fn collect_workspace_cleanup_ids(
    workspaces: &tokio::sync::Mutex<std::collections::HashMap<String, WorkspaceEntry>>,
    root_workspace_id: &str,
) -> Vec<String> {
    let workspaces = workspaces.lock().await;
    let mut ids = Vec::new();
    ids.push(root_workspace_id.to_string());

    if let Some(root) = workspaces.get(root_workspace_id) {
        if !root.kind.is_worktree() {
            ids.extend(
                workspaces
                    .values()
                    .filter(|entry| entry.parent_id.as_deref() == Some(root_workspace_id))
                    .map(|entry| entry.id.clone()),
            );
        }
    }

    ids
}

pub(crate) async fn cleanup_engine_sessions_for_workspace(
    state: &AppState,
    workspace_id: &str,
) -> Result<(), String> {
    crate::terminal::cleanup_terminal_sessions_for_workspace(state, workspace_id).await;
    crate::engine::commands::clear_mcp_toggle_state(workspace_id);
    state
        .engine_manager
        .remove_claude_session(workspace_id)
        .await;
    let gemini_cleanup_result = state
        .engine_manager
        .remove_gemini_session(workspace_id)
        .await;
    state
        .engine_manager
        .remove_codex_adapter(workspace_id)
        .await;
    state
        .engine_manager
        .remove_opencode_session(workspace_id)
        .await;
    let kimi_cleanup_result = state.engine_manager.remove_kimi_session(workspace_id).await;
    let grok_cleanup_result = state.engine_manager.remove_grok_session(workspace_id).await;
    match (
        gemini_cleanup_result,
        kimi_cleanup_result,
        grok_cleanup_result,
    ) {
        (Ok(()), Ok(()), Ok(())) => Ok(()),
        (gemini, kimi, grok) => {
            let mut errors = Vec::new();
            if let Err(error) = gemini {
                errors.push(format!("Gemini cleanup failed: {error}"));
            }
            if let Err(error) = kimi {
                errors.push(format!("Kimi cleanup failed: {error}"));
            }
            if let Err(error) = grok {
                errors.push(format!("Grok cleanup failed: {error}"));
            }
            Err(format!(
                "Engine cleanup failed for workspace {workspace_id}: {}",
                errors.join("; ")
            ))
        }
    }
}

#[tauri::command]
pub(crate) async fn read_workspace_file(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceFileResponse, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "read_workspace_file",
            json!({ "workspaceId": workspace_id, "path": path }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    workspaces_core::read_workspace_file_core(
        &state.workspaces,
        &workspace_id,
        &path,
        |root, rel_path| read_workspace_file_inner(root, rel_path),
    )
    .await
}

#[tauri::command]
pub(crate) async fn read_workspace_file_preview(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceFileResponse, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "read_workspace_file_preview",
            json!({ "workspaceId": workspace_id, "path": path }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    workspaces_core::read_workspace_file_core(
        &state.workspaces,
        &workspace_id,
        &path,
        |root, rel_path| read_workspace_file_preview_inner(root, rel_path),
    )
    .await
}

#[tauri::command]
pub(crate) async fn write_workspace_file(
    workspace_id: String,
    path: String,
    content: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        remote_backend::call_remote(
            &*state,
            app,
            "write_workspace_file",
            json!({ "workspaceId": workspace_id, "path": path, "content": content }),
        )
        .await?;
        return Ok(());
    }

    workspaces_core::write_workspace_file_core(
        &state.workspaces,
        &workspace_id,
        &path,
        &content,
        |root, rel_path, data| write_workspace_file_inner(root, rel_path, data),
    )
    .await
}

#[tauri::command]
pub(crate) async fn create_workspace_directory(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        return Err("create_workspace_directory is not supported in remote mode yet.".to_string());
    }

    workspaces_core::create_workspace_directory_core(
        &state.workspaces,
        &workspace_id,
        &path,
        |root, rel_path| create_workspace_directory_inner(root, rel_path),
    )
    .await
}

#[tauri::command]
pub(crate) async fn list_external_spec_tree(
    workspace_id: String,
    spec_root: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceFilesResponse, String> {
    const MAX_EXTERNAL_SPEC_TREE_FILES: usize = 8_000;
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "list_external_spec_tree",
            json!({ "workspaceId": workspace_id, "specRoot": spec_root }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    {
        let workspaces = state.workspaces.lock().await;
        if !workspaces.contains_key(&workspace_id) {
            return Err(format!("Workspace not found: {workspace_id}"));
        }
    }

    list_external_spec_tree_inner(&spec_root, MAX_EXTERNAL_SPEC_TREE_FILES)
}

#[tauri::command]
pub(crate) async fn read_external_spec_file(
    workspace_id: String,
    spec_root: String,
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ExternalSpecFileResponse, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "read_external_spec_file",
            json!({ "workspaceId": workspace_id, "specRoot": spec_root, "path": path }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    {
        let workspaces = state.workspaces.lock().await;
        if !workspaces.contains_key(&workspace_id) {
            return Err(format!("Workspace not found: {workspace_id}"));
        }
    }

    workspaces_core::run_blocking_file_io("read_external_spec_file", move || {
        read_external_spec_file_inner(&spec_root, &path)
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_external_absolute_file(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceFileResponse, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "read_external_absolute_file",
            json!({ "workspaceId": workspace_id, "path": path }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    let custom_skill_roots = {
        let app_settings = state.app_settings.lock().await;
        crate::skills::normalize_custom_skill_roots(app_settings.custom_skill_directories.clone())
    };
    let allowed_roots = {
        let workspaces = state.workspaces.lock().await;
        allowed_external_absolute_read_roots(
            &state,
            &workspaces,
            &workspace_id,
            &custom_skill_roots,
        )?
    };

    workspaces_core::run_blocking_file_io("read_external_absolute_file", move || {
        read_external_absolute_file_inner(&path, &allowed_roots)
    })
    .await
}

#[tauri::command]
pub(crate) async fn resolve_file_preview_handle(
    workspace_id: String,
    domain: String,
    path: String,
    spec_root: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspacePreviewHandleResponse, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "resolve_file_preview_handle",
            json!({
                "workspaceId": workspace_id,
                "domain": domain,
                "path": path,
                "specRoot": spec_root,
            }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    match domain.as_str() {
        "workspace" => {
            workspaces_core::read_workspace_file_core(
                &state.workspaces,
                &workspace_id,
                &path,
                |root, rel_path| resolve_workspace_preview_handle_inner(root, rel_path),
            )
            .await
        }
        "external-spec" => {
            {
                let workspaces = state.workspaces.lock().await;
                if !workspaces.contains_key(&workspace_id) {
                    return Err(format!("Workspace not found: {workspace_id}"));
                }
            }

            let root = spec_root.ok_or_else(|| "specRoot is required.".to_string())?;
            workspaces_core::run_blocking_file_io(
                "resolve_external_spec_preview_handle",
                move || resolve_external_spec_preview_handle_inner(&root, &path),
            )
            .await
        }
        "external-absolute" => {
            let custom_skill_roots = {
                let app_settings = state.app_settings.lock().await;
                crate::skills::normalize_custom_skill_roots(
                    app_settings.custom_skill_directories.clone(),
                )
            };
            let allowed_roots = {
                let workspaces = state.workspaces.lock().await;
                allowed_external_absolute_read_roots(
                    &state,
                    &workspaces,
                    &workspace_id,
                    &custom_skill_roots,
                )?
            };

            workspaces_core::run_blocking_file_io(
                "resolve_external_absolute_preview_handle",
                move || resolve_external_absolute_preview_handle_inner(&path, &allowed_roots),
            )
            .await
        }
        _ => Err("Unsupported preview handle domain.".to_string()),
    }
}

#[tauri::command]
pub(crate) async fn write_external_spec_file(
    workspace_id: String,
    spec_root: String,
    path: String,
    content: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        remote_backend::call_remote(
            &*state,
            app,
            "write_external_spec_file",
            json!({ "workspaceId": workspace_id, "specRoot": spec_root, "path": path, "content": content }),
        )
        .await?;
        return Ok(());
    }

    {
        let workspaces = state.workspaces.lock().await;
        if !workspaces.contains_key(&workspace_id) {
            return Err(format!("Workspace not found: {workspace_id}"));
        }
    }

    workspaces_core::run_blocking_file_io("write_external_spec_file", move || {
        write_external_spec_file_inner(&spec_root, &path, &content)
    })
    .await
}

#[tauri::command]
pub(crate) async fn write_external_absolute_file(
    workspace_id: String,
    path: String,
    content: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        remote_backend::call_remote(
            &*state,
            app,
            "write_external_absolute_file",
            json!({ "workspaceId": workspace_id, "path": path, "content": content }),
        )
        .await?;
        return Ok(());
    }

    let custom_skill_roots = {
        let app_settings = state.app_settings.lock().await;
        crate::skills::normalize_custom_skill_roots(app_settings.custom_skill_directories.clone())
    };
    let allowed_roots = {
        let workspaces = state.workspaces.lock().await;
        allowed_external_skill_roots(&state, &workspaces, &workspace_id, &custom_skill_roots)?
    };

    workspaces_core::run_blocking_file_io("write_external_absolute_file", move || {
        write_external_absolute_file_inner(&path, &allowed_roots, &content)
    })
    .await
}

#[tauri::command]
pub(crate) async fn trash_workspace_item(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        remote_backend::call_remote(
            &*state,
            app,
            "trash_workspace_item",
            json!({ "workspaceId": workspace_id, "path": path }),
        )
        .await?;
        return Ok(());
    }

    workspaces_core::trash_workspace_item_core(
        &state.workspaces,
        &workspace_id,
        &path,
        |root, rel_path| trash_workspace_item_inner(root, rel_path),
    )
    .await
}

#[tauri::command]
pub(crate) async fn copy_workspace_item(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "copy_workspace_item",
            json!({ "workspaceId": workspace_id, "path": path }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    workspaces_core::copy_workspace_item_core(
        &state.workspaces,
        &workspace_id,
        &path,
        |root, rel_path| copy_workspace_item_inner(root, rel_path),
    )
    .await
}

#[tauri::command]
pub(crate) async fn duplicate_workspace_item(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<WorkspaceFileOperationResult, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return Err("duplicate_workspace_item is not supported in remote mode yet.".to_string());
    }

    workspaces_core::duplicate_workspace_item_core(
        &state.workspaces,
        &workspace_id,
        &path,
        |root, rel_path| duplicate_workspace_item_inner(root, rel_path),
    )
    .await
}

#[tauri::command]
pub(crate) async fn paste_workspace_item(
    workspace_id: String,
    source_path: String,
    target_directory: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<WorkspaceFileOperationResult, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return Err("paste_workspace_item is not supported in remote mode yet.".to_string());
    }

    workspaces_core::paste_workspace_item_core(
        &state.workspaces,
        &workspace_id,
        &source_path,
        &target_directory,
        |root, rel_path, target| paste_workspace_item_inner(root, rel_path, target),
    )
    .await
}

#[tauri::command]
pub(crate) async fn rename_workspace_item(
    workspace_id: String,
    path: String,
    new_name: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<WorkspaceFileOperationResult, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return Err("rename_workspace_item is not supported in remote mode yet.".to_string());
    }

    workspaces_core::rename_workspace_item_core(
        &state.workspaces,
        &workspace_id,
        &path,
        &new_name,
        |root, rel_path, name| rename_workspace_item_inner(root, rel_path, name),
    )
    .await
}

#[tauri::command]
pub(crate) async fn paste_external_workspace_items(
    workspace_id: String,
    source_paths: Vec<String>,
    target_directory: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<Vec<WorkspaceFileOperationResult>, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return Err(
            "paste_external_workspace_items is not supported in remote mode yet.".to_string(),
        );
    }

    workspaces_core::paste_external_workspace_items_core(
        &state.workspaces,
        &workspace_id,
        &source_paths,
        &target_directory,
        |root, sources, target| paste_external_workspace_items_inner(root, sources, target),
    )
    .await
}

#[tauri::command]
pub(crate) async fn run_workspace_command(
    workspace_id: String,
    command: Vec<String>,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<WorkspaceCommandResult, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return Err("run_workspace_command is not supported in remote mode yet.".to_string());
    }

    let workspace_root = {
        let workspaces = state.workspaces.lock().await;
        let entry = workspaces
            .get(&workspace_id)
            .ok_or_else(|| format!("Workspace not found: {workspace_id}"))?;
        PathBuf::from(&entry.path)
    };

    run_command_with_cwd(command, &workspace_root, timeout_ms).await
}

#[tauri::command]
pub(crate) async fn run_spec_command(
    workspace_id: String,
    command: Vec<String>,
    custom_spec_root: Option<String>,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<WorkspaceCommandResult, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return Err("run_spec_command is not supported in remote mode yet.".to_string());
    }

    let workspace_root = {
        let workspaces = state.workspaces.lock().await;
        let entry = workspaces
            .get(&workspace_id)
            .ok_or_else(|| format!("Workspace not found: {workspace_id}"))?;
        PathBuf::from(&entry.path)
    };

    let (exec_dir, cleanup_dir) =
        prepare_spec_command_workdir(&workspace_root, custom_spec_root.as_deref())?;
    let run_result = run_command_with_cwd(command, &exec_dir, timeout_ms).await;
    if let Some(path) = cleanup_dir {
        cleanup_spec_command_workdir(&path);
    }
    run_result
}

#[tauri::command]
pub(crate) async fn list_workspaces(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<WorkspaceInfo>, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response =
            remote_backend::call_remote(&*state, app, "list_workspaces", json!({})).await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    Ok(workspaces_core::list_workspaces_core(&state.workspaces, &state.sessions).await)
}

#[tauri::command]
pub(crate) async fn take_workspaces_recovery_notice(
    state: State<'_, AppState>,
) -> Result<Option<WorkspacesRecoveryNotice>, String> {
    Ok(take_workspaces_recovery_notice_core(&state.workspaces_recovery_notice).await)
}

#[tauri::command]
pub(crate) async fn is_workspace_path_dir(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<bool, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "is_workspace_path_dir",
            json!({ "path": path }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }
    Ok(workspaces_core::is_workspace_path_dir_core(&path))
}

#[tauri::command]
pub(crate) async fn ensure_workspace_path_dir(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        remote_backend::call_remote(
            &*state,
            app,
            "ensure_workspace_path_dir",
            json!({ "path": path }),
        )
        .await?;
        return Ok(());
    }
    workspaces_core::ensure_workspace_path_dir_core(&path)
}

#[tauri::command]
pub(crate) async fn add_workspace(
    path: String,
    codex_bin: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceInfo, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let path = remote_backend::normalize_path_for_remote(path);
        let codex_bin = codex_bin.map(remote_backend::normalize_path_for_remote);
        let response = remote_backend::call_remote(
            &*state,
            app,
            "add_workspace",
            json!({ "path": path, "codex_bin": codex_bin }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    // Detect which engine to use based on settings and installed CLIs
    let (
        app_default_engine,
        claude_bin_setting,
        codex_bin_setting,
        qoder_bin_setting,
        disabled_engines,
    ) = {
        let settings = state.app_settings.lock().await;
        (
            settings.default_engine.clone(),
            settings.claude_bin.clone(),
            settings.codex_bin.clone(),
            settings.qoder_bin.clone(),
            detection_disabled_engines(&settings),
        )
    };

    let engine_type = resolve_engine_type(
        None, // New workspace has no settings yet
        app_default_engine.as_deref(),
        claude_bin_setting.as_deref(),
        codex_bin.as_deref().or(codex_bin_setting.as_deref()),
        None,
        None,
        None,
        None,
        None,
        None,
        qoder_bin_setting.as_deref(),
        &disabled_engines,
    )
    .await;

    match engine_type {
        EngineType::Claude => {
            // For Claude: No persistent session needed, just save workspace entry
            add_workspace_for_cli_engine(EngineType::Claude, path, codex_bin, &state).await
        }
        EngineType::Codex => {
            // For Codex: Use existing app-server based session
            workspaces_core::add_workspace_core(
                path,
                codex_bin,
                &state.workspaces,
                &state.sessions,
                &state.app_settings,
                &state.storage_path,
                |entry, default_bin, codex_args, codex_home| {
                    spawn_with_app(&app, entry, default_bin, codex_args, codex_home)
                },
            )
            .await
        }
        EngineType::OpenCode => {
            // OpenCode follows local CLI session model (no persistent daemon session).
            add_workspace_for_cli_engine(EngineType::OpenCode, path, codex_bin, &state).await
        }
        EngineType::Gemini => {
            // Gemini follows local CLI session model (no persistent daemon session).
            add_workspace_for_cli_engine(EngineType::Gemini, path, codex_bin, &state).await
        }
        EngineType::Kimi => {
            // Kimi follows local CLI session model (no persistent daemon session).
            add_workspace_for_cli_engine(EngineType::Kimi, path, codex_bin, &state).await
        }
        EngineType::Grok => {
            // Grok follows local CLI session model (no persistent daemon session).
            add_workspace_for_cli_engine(EngineType::Grok, path, codex_bin, &state).await
        }
        EngineType::Pi => {
            add_workspace_for_cli_engine(EngineType::Pi, path, codex_bin, &state).await
        }
        EngineType::Omp => {
            add_workspace_for_cli_engine(EngineType::Omp, path, codex_bin, &state).await
        }
        EngineType::Qoder => {
            add_workspace_for_cli_engine(EngineType::Qoder, path, codex_bin, &state).await
        }
        EngineType::Dsh => {
            add_workspace_for_cli_engine(EngineType::Dsh, path, codex_bin, &state).await
        }
    }
}

/// Add workspace for a CLI-based engine (no persistent session needed).
/// Supports Claude, Gemini, OpenCode, Kimi, Grok, Pi, Omp, Qoder and Dsh engines.
async fn add_workspace_for_cli_engine(
    engine_type: EngineType,
    path: String,
    codex_bin: Option<String>,
    state: &AppState,
) -> Result<WorkspaceInfo, String> {
    use crate::engine::status::{
        detect_claude_status, detect_grok_status, detect_kimi_status, detect_opencode_status,
        detect_omp_status, detect_pi_status, detect_qoder_status,
    };
    use std::path::PathBuf;

    if !PathBuf::from(&path).is_dir() {
        return Err("Workspace path must be a folder.".to_string());
    }

    let engine_name = match engine_type {
        EngineType::Claude => "claude",
        EngineType::Gemini => "gemini",
        EngineType::OpenCode => "opencode",
        EngineType::Kimi => "kimi",
        EngineType::Grok => "grok",
        EngineType::Pi => "pi",
        EngineType::Omp => "omp",
        EngineType::Qoder => "qoder",
        EngineType::Dsh => "dsh",
        _ => return Err(format!("Unsupported CLI engine: {:?}", engine_type)),
    };

    {
        let settings = state.app_settings.lock().await.clone();
        if !crate::engine::engine_enabled_in_settings(&settings, engine_type) {
            return Err(crate::engine::engine_disabled_diagnostic(engine_type)
                .unwrap_or("CLI engine is disabled in CLI validation settings")
                .to_string());
        }
    }

    // Verify the CLI is installed
    let cli_installed = match engine_type {
        EngineType::Claude => {
            let claude_bin = {
                let settings = state.app_settings.lock().await;
                settings.claude_bin.clone()
            };
            detect_claude_status(claude_bin.as_deref()).await.installed
        }
        EngineType::Gemini => false,
        EngineType::OpenCode => {
            let opencode_bin = {
                let settings = state.app_settings.lock().await;
                settings.opencode_bin.clone()
            };
            detect_opencode_status(opencode_bin.as_deref())
                .await
                .installed
        }
        EngineType::Kimi => {
            let kimi_bin = {
                let settings = state.app_settings.lock().await;
                settings.kimi_bin.clone()
            };
            detect_kimi_status(kimi_bin.as_deref()).await.installed
        }
        EngineType::Grok => {
            let grok_bin = {
                let settings = state.app_settings.lock().await;
                settings.grok_bin.clone()
            };
            detect_grok_status(grok_bin.as_deref()).await.installed
        }
        EngineType::Pi => {
            let pi_bin = {
                let settings = state.app_settings.lock().await;
                settings.pi_bin.clone()
            };
            detect_pi_status(pi_bin.as_deref()).await.installed
        }
        EngineType::Omp => {
            let omp_bin = {
                let settings = state.app_settings.lock().await;
                settings.omp_bin.clone()
            };
            detect_omp_status(omp_bin.as_deref()).await.installed
        }
        EngineType::Qoder => {
            let qoder_bin = {
                let settings = state.app_settings.lock().await;
                settings.qoder_bin.clone()
            };
            detect_qoder_status(qoder_bin.as_deref()).await.installed
        }
        // Host can start later; do not refuse the workspace if dsh is not installed yet.
        EngineType::Dsh => true,
        _ => false,
    };
    if !cli_installed {
        return Err(format!("CLI_NOT_FOUND:{}", engine_name));
    }

    let name = workspaces_core::workspace_name_from_path(&path);

    let settings = WorkspaceSettings {
        engine_type: Some(engine_name.to_string()),
        ..WorkspaceSettings::default()
    };

    let entry = WorkspaceEntry {
        id: Uuid::new_v4().to_string(),
        name: name.clone(),
        path: path.clone(),
        codex_bin,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };

    {
        let mut workspaces = state.workspaces.lock().await;
        workspaces.insert(entry.id.clone(), entry.clone());
        let list: Vec<_> = workspaces.values().cloned().collect();
        let merged = write_workspaces_preserving_existing(&state.storage_path, &list)?;
        *workspaces = merged
            .into_iter()
            .map(|workspace| (workspace.id.clone(), workspace))
            .collect();
    }

    Ok(WorkspaceInfo {
        id: entry.id,
        name: entry.name,
        path: entry.path,
        codex_bin: entry.codex_bin,
        connected: true,
        kind: entry.kind,
        parent_id: entry.parent_id,
        worktree: entry.worktree,
        settings: entry.settings,
    })
}

#[tauri::command]
pub(crate) async fn add_clone(
    source_workspace_id: String,
    copy_name: String,
    copies_folder: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceInfo, String> {
    let copy_name = copy_name.trim().to_string();
    if copy_name.is_empty() {
        return Err("Copy name is required.".to_string());
    }

    let copies_folder = copies_folder.trim().to_string();
    if copies_folder.is_empty() {
        return Err("Copies folder is required.".to_string());
    }
    let copies_folder_path = PathBuf::from(&copies_folder);
    std::fs::create_dir_all(&copies_folder_path)
        .map_err(|e| format!("Failed to create copies folder: {e}"))?;
    if !copies_folder_path.is_dir() {
        return Err("Copies folder must be a directory.".to_string());
    }

    let (source_entry, inherited_group_id) = {
        let workspaces = state.workspaces.lock().await;
        let source_entry = workspaces
            .get(&source_workspace_id)
            .cloned()
            .ok_or("source workspace not found")?;
        let inherited_group_id = if source_entry.kind.is_worktree() {
            source_entry
                .parent_id
                .as_ref()
                .and_then(|parent_id| workspaces.get(parent_id))
                .and_then(|parent| parent.settings.group_id.clone())
        } else {
            source_entry.settings.group_id.clone()
        };
        (source_entry, inherited_group_id)
    };

    let destination_path = build_clone_destination_path(&copies_folder_path, &copy_name);
    let destination_path_string = destination_path.to_string_lossy().to_string();

    if let Err(error) = run_git_command(
        &copies_folder_path,
        &["clone", &source_entry.path, &destination_path_string],
    )
    .await
    {
        let _ = tokio::fs::remove_dir_all(&destination_path).await;
        return Err(error);
    }

    if let Some(origin_url) = git_get_origin_url(&PathBuf::from(&source_entry.path)).await {
        let _ = run_git_command(
            &destination_path,
            &["remote", "set-url", "origin", &origin_url],
        )
        .await;
    }

    let entry = WorkspaceEntry {
        id: Uuid::new_v4().to_string(),
        name: copy_name.clone(),
        path: destination_path_string,
        codex_bin: source_entry.codex_bin.clone(),
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings: WorkspaceSettings {
            group_id: inherited_group_id,
            ..WorkspaceSettings::default()
        },
    };

    let (default_bin, codex_args) = {
        let settings = state.app_settings.lock().await;
        (
            settings.codex_bin.clone(),
            resolve_workspace_codex_args(&entry, None, Some(&settings)),
        )
    };
    let codex_home = resolve_workspace_codex_home(&entry, None);
    let session = match spawn_workspace_session(
        entry.clone(),
        default_bin,
        codex_args,
        app,
        codex_home,
    )
    .await
    {
        Ok(session) => session,
        Err(error) => {
            let _ = tokio::fs::remove_dir_all(&destination_path).await;
            return Err(error);
        }
    };

    if let Err(error) = {
        let mut workspaces = state.workspaces.lock().await;
        workspaces.insert(entry.id.clone(), entry.clone());
        let list: Vec<_> = workspaces.values().cloned().collect();
        let merged = write_workspaces_preserving_existing(&state.storage_path, &list)?;
        *workspaces = merged
            .into_iter()
            .map(|workspace| (workspace.id.clone(), workspace))
            .collect();
        Ok::<(), String>(())
    } {
        {
            let mut workspaces = state.workspaces.lock().await;
            workspaces.remove(&entry.id);
        }
        let _ = crate::runtime::terminate_workspace_session(session, None).await;
        let _ = tokio::fs::remove_dir_all(&destination_path).await;
        return Err(error);
    }

    crate::runtime::replace_workspace_session(
        &state.sessions,
        Some(&state.runtime_manager),
        entry.id.clone(),
        session,
        "workspace-clone",
    )
    .await?;

    Ok(WorkspaceInfo {
        id: entry.id,
        name: entry.name,
        path: entry.path,
        codex_bin: entry.codex_bin,
        connected: true,
        kind: entry.kind,
        parent_id: entry.parent_id,
        worktree: entry.worktree,
        settings: entry.settings,
    })
}

#[tauri::command]
pub(crate) async fn remove_workspace(
    id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        remote_backend::call_remote(&*state, app, "remove_workspace", json!({ "id": id })).await?;
        return Ok(());
    }

    let cleanup_ids = collect_workspace_cleanup_ids(&state.workspaces, &id).await;

    workspaces_core::remove_workspace_core(
        id.clone(),
        &state.workspaces,
        &state.sessions,
        &state.storage_path,
        |root, args| {
            workspaces_core::run_git_command_unit(root, args, |repo, args_owned| {
                run_git_command_owned(repo, args_owned)
            })
        },
        |error| is_missing_worktree_error(error),
        |path| {
            std::fs::remove_dir_all(path)
                .map_err(|err| format!("Failed to remove worktree folder: {err}"))
        },
        true,
        true,
    )
    .await?;

    let mut cleanup_errors = Vec::new();
    for workspace_id in cleanup_ids {
        if let Err(error) = cleanup_engine_sessions_for_workspace(&state, &workspace_id).await {
            cleanup_errors.push(error);
        }
    }
    if !cleanup_errors.is_empty() {
        return Err(format!(
            "workspace removed but engine cleanup failed: {}",
            cleanup_errors.join("; ")
        ));
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn update_workspace_settings(
    id: String,
    settings: WorkspaceSettings,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceInfo, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "update_workspace_settings",
            json!({ "id": id, "settings": settings }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    workspaces_core::update_workspace_settings_core(
        id,
        settings,
        &state.workspaces,
        &state.sessions,
        &state.app_settings,
        &state.storage_path,
        |workspaces, workspace_id, next_settings| {
            apply_workspace_settings_update(workspaces, workspace_id, next_settings)
        },
        |entry, default_bin, codex_args, codex_home| {
            spawn_with_app(&app, entry, default_bin, codex_args, codex_home)
        },
    )
    .await
}

#[tauri::command]
pub(crate) async fn update_workspace_codex_bin(
    id: String,
    codex_bin: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceInfo, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let codex_bin = codex_bin.map(remote_backend::normalize_path_for_remote);
        let response = remote_backend::call_remote(
            &*state,
            app,
            "update_workspace_codex_bin",
            json!({ "id": id, "codex_bin": codex_bin }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    workspaces_core::update_workspace_codex_bin_core(
        id,
        codex_bin,
        &state.workspaces,
        &state.sessions,
        &state.storage_path,
    )
    .await
}

#[tauri::command]
pub(crate) async fn connect_workspace(
    id: String,
    recovery_source: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        remote_backend::call_remote(
            &*state,
            app,
            "connect_workspace",
            json!({ "id": id, "recoverySource": recovery_source }),
        )
        .await?;
        return Ok(());
    }

    // Get workspace entry to check engine type
    let entry = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&id)
            .cloned()
            .ok_or_else(|| "workspace not found".to_string())?
    };

    if !workspaces_core::workspace_requires_persistent_session(&entry) {
        // Claude/Gemini/OpenCode do not require a persistent workspace session.
        Ok(())
    } else {
        // For Codex: Use existing session spawn logic
        let recovery_source = recovery_source.unwrap_or_else(|| "explicit-connect".to_string());
        let automatic_recovery = recovery_source != "explicit-connect";
        workspaces_core::connect_workspace_core(
            id,
            &state.workspaces,
            &state.sessions,
            &state.app_settings,
            Some(&state.runtime_manager),
            &recovery_source,
            automatic_recovery,
            |entry, default_bin, codex_args, codex_home| {
                spawn_with_app(&app, entry, default_bin, codex_args, codex_home)
            },
        )
        .await
    }
}

#[tauri::command]
pub(crate) async fn list_workspace_files(
    workspace_id: String,
    force_refresh: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceFilesResponse, String> {
    const MAX_WORKSPACE_FILE_ENTRIES: usize = 12_000;
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "list_workspace_files",
            json!({ "workspaceId": workspace_id, "forceRefresh": force_refresh.unwrap_or(false) }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    let root = workspaces_core::resolve_workspace_root(&state.workspaces, &workspace_id).await?;
    let force_refresh = force_refresh.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        list_workspace_files_inner_with_refresh(&root, MAX_WORKSPACE_FILE_ENTRIES, force_refresh)
    })
    .await
    .map_err(|err| format!("failed to join workspace file scan task: {err}"))
}

#[tauri::command]
pub(crate) async fn list_workspace_directory_children(
    workspace_id: String,
    path: String,
    force_refresh: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceFilesResponse, String> {
    const MAX_WORKSPACE_DIRECTORY_CHILDREN: usize = 2_000;
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "list_workspace_directory_children",
            json!({ "workspaceId": workspace_id, "path": path, "forceRefresh": force_refresh.unwrap_or(false) }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    let root = workspaces_core::resolve_workspace_root(&state.workspaces, &workspace_id).await?;
    let force_refresh = force_refresh.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        list_workspace_directory_children_inner_with_refresh(
            &root,
            &path,
            MAX_WORKSPACE_DIRECTORY_CHILDREN,
            force_refresh,
        )
    })
    .await
    .map_err(|err| format!("failed to join workspace directory scan task: {err}"))?
}

#[tauri::command]
pub(crate) async fn list_external_absolute_directory_children(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceFilesResponse, String> {
    const MAX_EXTERNAL_DIRECTORY_CHILDREN: usize = 2_000;
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "list_external_absolute_directory_children",
            json!({ "workspaceId": workspace_id, "path": path }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    let custom_skill_roots = {
        let app_settings = state.app_settings.lock().await;
        crate::skills::normalize_custom_skill_roots(app_settings.custom_skill_directories.clone())
    };
    let allowed_roots = {
        let workspaces = state.workspaces.lock().await;
        allowed_external_skill_roots(&state, &workspaces, &workspace_id, &custom_skill_roots)?
    };

    list_external_absolute_directory_children_inner(
        &path,
        &allowed_roots,
        MAX_EXTERNAL_DIRECTORY_CHILDREN,
    )
}

#[tauri::command]
pub(crate) async fn search_workspace_text(
    workspace_id: String,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    is_regex: bool,
    include_pattern: Option<String>,
    exclude_pattern: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceTextSearchResponse, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "search_workspace_text",
            json!({
                "workspaceId": workspace_id,
                "query": query,
                "caseSensitive": case_sensitive,
                "wholeWord": whole_word,
                "isRegex": is_regex,
                "includePattern": include_pattern,
                "excludePattern": exclude_pattern,
            }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    let options = WorkspaceTextSearchOptions {
        case_sensitive,
        whole_word,
        is_regex,
        include_pattern,
        exclude_pattern,
    };
    workspaces_core::list_workspace_files_core(&state.workspaces, &workspace_id, |root| {
        search_workspace_text_inner(root, &query, &options)
    })
    .await?
}

#[tauri::command]
pub(crate) async fn configure_detached_external_change_monitor(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    workspace_path: String,
    active_file_path: String,
    watcher_enabled: bool,
) -> Result<DetachedExternalMonitorStatus, String> {
    configure_detached_external_change_monitor_inner(
        app,
        &state.detached_external_change_runtime,
        workspace_id,
        workspace_path,
        active_file_path,
        watcher_enabled,
    )
    .await
}

#[tauri::command]
pub(crate) async fn clear_detached_external_change_monitor(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), String> {
    clear_detached_external_change_monitor_inner(
        &state.detached_external_change_runtime,
        workspace_id,
    )
    .await
}

/// 2.3 PI 后台任务输出日志按需 tail：读 workspace 文件末尾 ≤8 KiB
/// （byte budget 对齐 tool-output 口径），首字节不整读。
#[tauri::command]
pub(crate) async fn read_workspace_file_tail(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceFileResponse, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "read_workspace_file_tail",
            json!({ "workspaceId": workspace_id, "path": path }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }
    workspaces_core::read_workspace_file_core(
        &state.workspaces,
        &workspace_id,
        &path,
        |root, rel_path| read_workspace_file_tail_inner(root, rel_path, 8 * 1024),
    )
    .await
}

/// 2.2 断链判定：PI 后台任务 registry 进程存活探测（`libc::kill(pid, 0)`，
/// 无信号副作用）。pid <= 0 或已被回收返回 false。
#[tauri::command]
pub(crate) fn process_is_alive(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    #[cfg(unix)]
    {
        // kill(pid, 0) 仅探测可发送信号；ESRCH=进程不存在，EPERM/0=存在。
        unsafe { libc::kill(pid, 0) == 0 }
    }
    #[cfg(windows)]
    {
        // Windows 没有 POSIX kill(pid, 0) 等价探测面，按"已断链"返回 false
        // 由上层 watchdog / reconnect 兜底，宁误报回收不误报存活。
        false
    }
}

#[cfg(test)]
mod tests {
    use super::{
        format_open_new_window_failure, normalize_new_window_path, normalize_open_target_value,
        prepare_spec_command_workdir, DEFAULT_MACOS_APP_NAME,
    };
    use uuid::Uuid;

    #[cfg(target_os = "macos")]
    use super::build_macos_new_window_open_args;
    #[cfg(not(target_os = "macos"))]
    use super::open_app_command_candidates;
    #[cfg(target_os = "macos")]
    use std::path::Path;

    #[test]
    fn probe_open_app_presets_sync_returns_catalog_entries() {
        let results = super::probe_open_app_presets_sync();
        assert!(!results.is_empty());
        assert!(results.iter().any(|item| item.id == "vscode"));
        assert!(results.iter().any(|item| item.id == "cursor"));
    }

    #[test]
    fn probe_open_app_target_finder_is_ok() {
        let result = super::probe_open_app_target_sync("finder", None, None);
        assert_eq!(result.status, "ok");
        assert!(result.installed);
    }

    #[test]
    fn probe_open_app_target_empty_app_is_broken() {
        let result = super::probe_open_app_target_sync("app", Some("  "), None);
        assert_eq!(result.status, "broken");
        assert!(!result.installed);
    }

    #[test]
    fn probe_open_app_target_missing_absolute_path_is_broken() {
        let result = super::probe_open_app_target_sync(
            "app",
            Some("/definitely/not/an/app/that/exists-mossx-probe.app"),
            None,
        );
        assert_eq!(result.status, "broken");
        assert!(!result.installed);
    }

    #[test]
    fn normalize_new_window_path_trims_and_drops_empty_values() {
        assert_eq!(normalize_new_window_path(None), None);
        assert_eq!(normalize_new_window_path(Some("".to_string())), None);
        assert_eq!(normalize_new_window_path(Some("   ".to_string())), None);
        assert_eq!(
            normalize_new_window_path(Some("  /tmp/demo  ".to_string())),
            Some("/tmp/demo".to_string())
        );
    }

    #[test]
    fn normalize_open_target_value_trims_quotes_and_empty_values() {
        assert_eq!(normalize_open_target_value(None), None);
        assert_eq!(normalize_open_target_value(Some("   ".to_string())), None);
        assert_eq!(
            normalize_open_target_value(Some(
                r#"  "C:\Program Files\Microsoft VS Code\Code.exe"  "#.to_string()
            )),
            Some(r#"C:\Program Files\Microsoft VS Code\Code.exe"#.to_string())
        );
        assert_eq!(
            normalize_open_target_value(Some("  'Visual Studio Code'  ".to_string())),
            Some("Visual Studio Code".to_string())
        );
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn open_app_command_candidates_include_cli_alias_for_vscode_display_name() {
        let candidates = open_app_command_candidates(" Visual Studio Code ");
        assert_eq!(
            candidates.first().map(String::as_str),
            Some("Visual Studio Code")
        );
        assert!(candidates.iter().any(|candidate| candidate == "code"));
    }

    #[test]
    fn format_open_new_window_failure_reports_exit_detail() {
        assert_eq!(
            format_open_new_window_failure(Some(9)),
            "Failed to open new app window (open returned exit code 9)."
        );
        assert_eq!(
            format_open_new_window_failure(None),
            "Failed to open new app window (open returned terminated by signal)."
        );
    }

    #[test]
    fn prepare_spec_command_workdir_accepts_project_root_with_openspec_child() {
        let project_root =
            std::env::temp_dir().join(format!("mossx-spec-project-{}", Uuid::new_v4()));
        std::fs::create_dir_all(project_root.join("openspec")).expect("create openspec dir");
        let workspace_root = project_root.join("workspace");
        std::fs::create_dir_all(&workspace_root).expect("create workspace root");

        let (exec_dir, cleanup_dir) = prepare_spec_command_workdir(
            &workspace_root,
            Some(project_root.to_str().expect("project root")),
        )
        .expect("prepare spec workdir");

        assert_eq!(
            exec_dir,
            project_root.canonicalize().expect("canonical project root")
        );
        assert_eq!(cleanup_dir, None);

        std::fs::remove_dir_all(&project_root).expect("cleanup");
    }

    #[test]
    fn prepare_spec_command_workdir_accepts_project_root_without_openspec_child() {
        let project_root =
            std::env::temp_dir().join(format!("mossx-spec-project-empty-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&project_root).expect("create project root");
        let workspace_root = project_root.join("workspace");
        std::fs::create_dir_all(&workspace_root).expect("create workspace root");

        let (exec_dir, cleanup_dir) = prepare_spec_command_workdir(
            &workspace_root,
            Some(project_root.to_str().expect("project root")),
        )
        .expect("prepare spec workdir");

        assert_eq!(
            exec_dir,
            project_root.canonicalize().expect("canonical project root")
        );
        assert_eq!(cleanup_dir, None);

        std::fs::remove_dir_all(&project_root).expect("cleanup");
    }

    #[test]
    fn prepare_spec_command_workdir_supports_direct_openspec_root_input() {
        let project_root =
            std::env::temp_dir().join(format!("mossx-spec-direct-{}", Uuid::new_v4()));
        let openspec_root = project_root.join("openspec");
        std::fs::create_dir_all(&openspec_root).expect("create openspec dir");
        let workspace_root = project_root.join("workspace");
        std::fs::create_dir_all(&workspace_root).expect("create workspace root");

        let (exec_dir, cleanup_dir) = prepare_spec_command_workdir(
            &workspace_root,
            Some(openspec_root.to_str().expect("openspec root")),
        )
        .expect("prepare spec workdir");

        assert_eq!(
            exec_dir,
            project_root.canonicalize().expect("canonical project root")
        );
        assert_eq!(cleanup_dir, None);

        std::fs::remove_dir_all(&project_root).expect("cleanup");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn build_macos_new_window_open_args_uses_workspace_path_when_provided() {
        let args = build_macos_new_window_open_args(
            Some(Path::new("/Applications/ccgui.app")),
            Some("/tmp/project"),
        );
        assert_eq!(
            args,
            vec![
                "-n".to_string(),
                "-a".to_string(),
                "/Applications/ccgui.app".to_string(),
                "/tmp/project".to_string(),
            ]
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn build_macos_new_window_open_args_falls_back_to_default_app_name() {
        let args = build_macos_new_window_open_args(None, None);
        assert_eq!(
            args,
            vec![
                "-n".to_string(),
                "-a".to_string(),
                DEFAULT_MACOS_APP_NAME.to_string(),
            ]
        );
    }
}
