use serde_json::Value;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use super::filter::{claude_project_dirs_for_path, claude_projects_dir, normalize_session_id};
use super::loader::{
    find_claude_session_file, is_target_user_message_entry, resolve_session_file_path,
    rewrite_session_id_fields,
};
use super::super::claude_history_entries::{
    classify_claude_history_entry, ClaudeHistoryEntryClassification,
};
use super::super::claude_history_large_payload::{
    estimate_base64_decoded_bytes, is_supported_image_media_type, ClaudeDeferredImageLocator,
    ClaudeHydratedImage, CLAUDE_HYDRATED_IMAGE_BASE64_BYTE_BUDGET,
};
use super::super::claude_history_subagents::ClaudeSubagentSessionId;
use super::super::EngineConfig;

pub async fn hydrate_claude_deferred_image_with_config(
    workspace_path: &Path,
    locator: ClaudeDeferredImageLocator,
    config: Option<&EngineConfig>,
) -> Result<ClaudeHydratedImage, String> {
    let normalized_session_id = normalize_session_id(&locator.session_id)?;
    if normalized_session_id != locator.session_id {
        return Err("Invalid Claude deferred image session id".to_string());
    }
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    hydrate_claude_deferred_image_from_base_dir(&base_dir, workspace_path, locator).await
}

pub(crate) async fn hydrate_claude_deferred_image_from_base_dir(
    base_dir: &Path,
    workspace_path: &Path,
    locator: ClaudeDeferredImageLocator,
) -> Result<ClaudeHydratedImage, String> {
    if !is_supported_image_media_type(Some(&locator.media_type)) {
        return Err(format!(
            "Unsupported Claude deferred image media type: {}",
            locator.media_type
        ));
    }

    let session_file = find_claude_session_file(base_dir, workspace_path, &locator.session_id)?;
    let file = fs::File::open(&session_file)
        .await
        .map_err(|error| format!("Failed to open Claude deferred image session file: {error}"))?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();
    let mut current_line_index = 0usize;

    while let Ok(Some(line)) = lines.next_line().await {
        if current_line_index != locator.line_index {
            current_line_index += 1;
            continue;
        }

        let entry: Value = serde_json::from_str(line.trim())
            .map_err(|error| format!("Failed to parse Claude deferred image line: {error}"))?;
        let uuid = entry.get("uuid").and_then(Value::as_str);
        if let Some(expected_message_id) = locator.message_id.as_deref() {
            if uuid != Some(expected_message_id) {
                return Err(
                    "Claude deferred image locator no longer matches message id".to_string()
                );
            }
        }
        let blocks = entry
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_array)
            .ok_or_else(|| {
                "Claude deferred image locator line has no content blocks".to_string()
            })?;
        let block = blocks
            .get(locator.block_index)
            .ok_or_else(|| "Claude deferred image block no longer exists".to_string())?;
        let source = block
            .get("source")
            .and_then(Value::as_object)
            .ok_or_else(|| "Claude deferred image block has no source".to_string())?;
        let source_type = source
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if source_type != "base64" {
            return Err("Claude deferred image block is not base64 media".to_string());
        }
        let media_type = source
            .get("media_type")
            .and_then(Value::as_str)
            .unwrap_or("image/png")
            .trim()
            .to_string();
        if media_type != locator.media_type || !is_supported_image_media_type(Some(&media_type)) {
            return Err("Claude deferred image media type no longer matches".to_string());
        }
        let payload = source
            .get("data")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Claude deferred image payload is missing".to_string())?;
        if payload.len() > CLAUDE_HYDRATED_IMAGE_BASE64_BYTE_BUDGET {
            return Err("Claude deferred image payload exceeds hydration budget".to_string());
        }
        let byte_size = estimate_base64_decoded_bytes(payload);
        return Ok(ClaudeHydratedImage {
            locator,
            src: format!("data:{};base64,{}", media_type, payload),
            media_type,
            byte_size,
        });
    }

    Err("Claude deferred image locator line no longer exists".to_string())
}

pub async fn fork_claude_session_with_config(
    workspace_path: &Path,
    session_id: &str,
    config: Option<&EngineConfig>,
) -> Result<String, String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    let source_file = resolve_session_file_path(&base_dir, workspace_path, &normalized_session_id)?;
    let target_dir = source_file
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Invalid session file path".to_string())?;

    let forked_session_id = uuid::Uuid::new_v4().to_string();
    let target_file = target_dir.join(format!("{}.jsonl", forked_session_id));

    let src = fs::File::open(&source_file)
        .await
        .map_err(|e| format!("Failed to open source session file: {}", e))?;
    let mut reader = BufReader::new(src).lines();

    let mut dst = fs::File::create(&target_file)
        .await
        .map_err(|e| format!("Failed to create forked session file: {}", e))?;

    while let Ok(Some(line)) = reader.next_line().await {
        let mut output = line;
        if let Ok(mut json_value) = serde_json::from_str::<Value>(&output) {
            rewrite_session_id_fields(&mut json_value, &normalized_session_id, &forked_session_id);
            output = serde_json::to_string(&json_value)
                .map_err(|e| format!("Failed to serialize forked session entry: {}", e))?;
        }
        dst.write_all(output.as_bytes())
            .await
            .map_err(|e| format!("Failed to write forked session entry: {}", e))?;
        dst.write_all(b"\n")
            .await
            .map_err(|e| format!("Failed to finalize forked session entry: {}", e))?;
    }

    dst.flush()
        .await
        .map_err(|e| format!("Failed to flush forked session file: {}", e))?;

    Ok(forked_session_id)
}

/// Fork a Claude session from a specific user message.
///
/// Clones `{session_id}.jsonl` into a new UUID session file, rewriting all
/// `session_id/sessionId` fields, and truncating history before the target user
/// message (exclusive). This preserves rewind semantics as full user+assistant
/// turn rollback. Returns an error when the target message id cannot be found.
pub(crate) async fn fork_claude_session_from_message_in_base_dir(
    base_dir: &Path,
    workspace_path: &Path,
    session_id: &str,
    message_id: &str,
) -> Result<String, String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let target_message_id = message_id.trim();
    if target_message_id.is_empty() {
        return Err("message_id is required".to_string());
    }

    let source_file = resolve_session_file_path(base_dir, workspace_path, &normalized_session_id)?;
    let target_dir = source_file
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Invalid session file path".to_string())?;

    let forked_session_id = uuid::Uuid::new_v4().to_string();
    let target_file = target_dir.join(format!("{}.jsonl", forked_session_id));

    let src = fs::File::open(&source_file)
        .await
        .map_err(|e| format!("Failed to open source session file: {}", e))?;
    let mut reader = BufReader::new(src).lines();
    let mut dst = fs::File::create(&target_file)
        .await
        .map_err(|e| format!("Failed to create forked session file: {}", e))?;
    let mut found_target = false;

    while let Ok(Some(line)) = reader.next_line().await {
        let mut output = line;
        if let Ok(mut json_value) = serde_json::from_str::<Value>(&output) {
            if is_target_user_message_entry(&json_value, target_message_id) {
                found_target = true;
                break;
            }
            if matches!(
                classify_claude_history_entry(&json_value),
                ClaudeHistoryEntryClassification::Hidden(_)
            ) {
                continue;
            }
            rewrite_session_id_fields(&mut json_value, &normalized_session_id, &forked_session_id);
            output = serde_json::to_string(&json_value)
                .map_err(|e| format!("Failed to serialize forked session entry: {}", e))?;
        }
        dst.write_all(output.as_bytes())
            .await
            .map_err(|e| format!("Failed to write forked session entry: {}", e))?;
        dst.write_all(b"\n")
            .await
            .map_err(|e| format!("Failed to finalize forked session entry: {}", e))?;
    }

    if !found_target {
        let _ = fs::remove_file(&target_file).await;
        return Err(format!(
            "Target user message not found in session {}: {}",
            normalized_session_id, target_message_id
        ));
    }

    dst.flush()
        .await
        .map_err(|e| format!("Failed to flush forked session file: {}", e))?;

    Ok(forked_session_id)
}

pub async fn fork_claude_session_from_message_with_config(
    workspace_path: &Path,
    session_id: &str,
    message_id: &str,
    config: Option<&EngineConfig>,
) -> Result<String, String> {
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    fork_claude_session_from_message_in_base_dir(&base_dir, workspace_path, session_id, message_id)
        .await
}

async fn remove_file_if_exists(path: &Path, action: &str) -> Result<bool, String> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "Failed to {} {}: {}",
            action,
            path.display(),
            error
        )),
    }
}

async fn remove_dir_if_exists(path: &Path, action: &str) -> Result<bool, String> {
    match fs::remove_dir_all(path).await {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "Failed to {} {}: {}",
            action,
            path.display(),
            error
        )),
    }
}

async fn remove_dir_if_empty(path: &Path) -> Result<(), String> {
    match fs::remove_dir(path).await {
        Ok(()) => Ok(()),
        Err(error)
            if matches!(
                error.kind(),
                ErrorKind::NotFound | ErrorKind::DirectoryNotEmpty
            ) =>
        {
            Ok(())
        }
        Err(error) => Err(format!(
            "Failed to remove empty Claude subagent directory {}: {}",
            path.display(),
            error
        )),
    }
}

pub async fn delete_claude_session_with_config(
    workspace_path: &Path,
    session_id: &str,
    config: Option<&EngineConfig>,
) -> Result<(), String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    let project_dirs = claude_project_dirs_for_path(&base_dir, workspace_path);

    let mut deleted = false;

    if let Some(subagent_id) = ClaudeSubagentSessionId::parse(&normalized_session_id) {
        for project_dir in project_dirs {
            let transcript_deleted = remove_file_if_exists(
                &subagent_id.transcript_path(&project_dir),
                "delete Claude subagent transcript",
            )
            .await?;
            let meta_deleted = remove_file_if_exists(
                &subagent_id.meta_path(&project_dir),
                "delete Claude subagent metadata",
            )
            .await?;
            deleted |= transcript_deleted || meta_deleted;
            let subagents_dir = project_dir
                .join(&subagent_id.parent_session_id)
                .join("subagents");
            remove_dir_if_empty(&subagents_dir).await?;
            remove_dir_if_empty(&project_dir.join(&subagent_id.parent_session_id)).await?;
        }

        return if deleted {
            Ok(())
        } else {
            Err(format!("Session file not found: {}", normalized_session_id))
        };
    }

    let session_filename = format!("{}.jsonl", normalized_session_id);
    let agent_prefix = format!("agent-{}", normalized_session_id);

    for project_dir in project_dirs {
        // Delete the main session file
        let session_file = project_dir.join(&session_filename);
        deleted |= remove_file_if_exists(&session_file, "delete Claude session file").await?;

        let subagent_parent_dir = project_dir.join(&normalized_session_id);
        deleted |=
            remove_dir_if_exists(&subagent_parent_dir, "delete Claude subagent directory").await?;

        // Also delete any agent-{session_id}*.jsonl subagent files
        if project_dir.exists() {
            if let Ok(mut entries) = fs::read_dir(&project_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.starts_with(&agent_prefix) && name.ends_with(".jsonl") {
                            remove_file_if_exists(
                                &entry.path(),
                                "delete legacy Claude subagent transcript",
                            )
                            .await?;
                        }
                    }
                }
            }
        }
    }

    if deleted {
        Ok(())
    } else {
        Err(format!("Session file not found: {}", normalized_session_id))
    }
}
