use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio::time::timeout;

use super::commit_message::{build_commit_message_prompt, combine_repository_diff_sections};
use super::session_runtime::ensure_codex_session;
use super::thread_lifecycle::record_hidden_codex_helper_thread;
use crate::backend::app_server::WorkspaceSession;
use crate::backend::events::AppServerEvent;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitMessageRepositorySelection {
    repository_root: String,
    selected_paths: Vec<String>,
}

async fn collect_commit_message_diff(
    workspace_id: &str,
    state: &State<'_, AppState>,
    selected_paths: Option<&[String]>,
    repository_selections: Option<&[CommitMessageRepositorySelection]>,
) -> Result<String, String> {
    let Some(repository_selections) = repository_selections else {
        return crate::git::get_workspace_diff_for_commit_scope(
            workspace_id,
            state,
            selected_paths,
            None,
        )
        .await;
    };
    if repository_selections.is_empty() {
        return Ok(String::new());
    }

    let mut sections = Vec::with_capacity(repository_selections.len());
    for selection in repository_selections {
        let diff = crate::git::get_workspace_diff_for_commit_scope(
            workspace_id,
            state,
            Some(&selection.selected_paths),
            Some(&selection.repository_root),
        )
        .await?;
        let repository_label = if selection.repository_root.is_empty() {
            "."
        } else {
            selection.repository_root.as_str()
        };
        sections.push((repository_label.to_string(), diff));
    }
    Ok(combine_repository_diff_sections(sections))
}

/// Gets the diff content for commit message generation
#[tauri::command]
pub(crate) async fn get_commit_message_prompt(
    workspace_id: String,
    language: Option<String>,
    selected_paths: Option<Vec<String>>,
    repository_selections: Option<Vec<CommitMessageRepositorySelection>>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Get the diff from git
    let diff = collect_commit_message_diff(
        &workspace_id,
        &state,
        selected_paths.as_deref(),
        repository_selections.as_deref(),
    )
    .await?;

    if diff.trim().is_empty() {
        return Err("No changes to generate commit message for".to_string());
    }

    Ok(build_commit_message_prompt(&diff, language.as_deref()))
}

async fn resolve_codex_session_for_commit_message(
    workspace_id: &str,
    state: &AppState,
) -> Result<Arc<WorkspaceSession>, String> {
    let session = {
        let sessions = state.sessions.lock().await;
        sessions.get(workspace_id).cloned()
    };
    if let Some(session) = session {
        return Ok(session);
    }

    let is_claude = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(workspace_id)
            .map(|entry| {
                entry
                    .settings
                    .engine_type
                    .as_deref()
                    .map(|engine| engine.eq_ignore_ascii_case("claude"))
                    .unwrap_or(true)
            })
            .unwrap_or(false)
    };
    if is_claude {
        return Err("AI commit message generation requires the Codex CLI. \
             Please install it first: npm install -g @openai/codex"
            .to_string());
    }
    Err(
        "Workspace not connected. Please ensure the Codex CLI is installed \
         and reconnect the workspace."
            .to_string(),
    )
}

async fn generate_commit_message_on_session(
    workspace_id: &str,
    prompt: &str,
    session: Arc<WorkspaceSession>,
    state: &AppState,
    app: &AppHandle,
) -> Result<String, String> {
    // Create a background helper thread (hidden from the main chat sidebar).
    let thread_params = json!({
        "cwd": session.entry.path,
        "approvalPolicy": "never"
    });
    let thread_result = session.send_request("thread/start", thread_params).await?;

    if let Some(error) = thread_result.get("error") {
        let error_msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error starting thread");
        return Err(error_msg.to_string());
    }

    let thread_id = thread_result
        .get("result")
        .and_then(|r| r.get("threadId"))
        .or_else(|| {
            thread_result
                .get("result")
                .and_then(|r| r.get("thread"))
                .and_then(|t| t.get("id"))
        })
        .or_else(|| thread_result.get("threadId"))
        .or_else(|| thread_result.get("thread").and_then(|t| t.get("id")))
        .and_then(|t| t.as_str())
        .ok_or_else(|| {
            format!(
                "Failed to get threadId from thread/start response: {:?}",
                thread_result
            )
        })?
        .to_string();
    record_hidden_codex_helper_thread(state, workspace_id, &thread_id, "commit-message", "git")
        .await;

    // Hide background helper threads from the sidebar, even if a thread/started event leaked.
    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id: workspace_id.to_string(),
            message: json!({
                "method": "codex/backgroundThread",
                "params": {
                    "threadId": thread_id,
                    "action": "hide"
                }
            }),
        },
    );

    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.insert(thread_id.clone(), tx);
    }

    let turn_params = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": prompt }],
        "cwd": session.entry.path,
        "approvalPolicy": "never",
        "sandboxPolicy": { "type": "readOnly" },
    });
    let turn_result = match session.send_request("turn/start", turn_params).await {
        Ok(result) => result,
        Err(error) => {
            {
                let mut callbacks = session.background_thread_callbacks.lock().await;
                callbacks.remove(&thread_id);
            }
            let archive_params = json!({ "threadId": thread_id.as_str() });
            let _ = session.send_request("thread/archive", archive_params).await;
            return Err(error);
        }
    };

    if let Some(error) = turn_result.get("error") {
        let error_msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error starting turn");
        {
            let mut callbacks = session.background_thread_callbacks.lock().await;
            callbacks.remove(&thread_id);
        }
        let archive_params = json!({ "threadId": thread_id.as_str() });
        let _ = session.send_request("thread/archive", archive_params).await;
        return Err(error_msg.to_string());
    }

    let mut commit_message = String::new();
    let timeout_duration = Duration::from_secs(60);
    let collect_result = timeout(timeout_duration, async {
        while let Some(event) = rx.recv().await {
            let method = event.get("method").and_then(|m| m.as_str()).unwrap_or("");

            match method {
                "item/agentMessage/delta" => {
                    if let Some(params) = event.get("params") {
                        if let Some(delta) = params.get("delta").and_then(|d| d.as_str()) {
                            commit_message.push_str(delta);
                        }
                    }
                }
                "turn/completed" => {
                    break;
                }
                "turn/error" => {
                    let error_msg = event
                        .get("params")
                        .and_then(|p| p.get("error"))
                        .and_then(|e| e.as_str())
                        .unwrap_or("Unknown error during commit message generation");
                    return Err(error_msg.to_string());
                }
                _ => {}
            }
        }
        Ok(())
    })
    .await;

    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.remove(&thread_id);
    }

    let archive_params = json!({ "threadId": thread_id });
    let _ = session.send_request("thread/archive", archive_params).await;

    match collect_result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("Timeout waiting for commit message generation".to_string()),
    }

    let trimmed = commit_message.trim().to_string();
    if trimmed.is_empty() {
        return Err("No commit message was generated".to_string());
    }

    Ok(trimmed)
}

/// Generates a commit message in the background without showing in the main chat.
///
/// Uses the same runtime ensure + bounded broken-pipe recovery as create-session:
/// stale Codex app-server transports are probed/replaced before `thread/start`, and a
/// single transport disconnect is retried after re-acquire.
#[tauri::command]
pub(crate) async fn generate_commit_message(
    workspace_id: String,
    language: Option<String>,
    selected_paths: Option<Vec<String>>,
    repository_selections: Option<Vec<CommitMessageRepositorySelection>>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let diff = collect_commit_message_diff(
        &workspace_id,
        &state,
        selected_paths.as_deref(),
        repository_selections.as_deref(),
    )
    .await?;

    if diff.trim().is_empty() {
        return Err("No changes to generate commit message for".to_string());
    }

    let prompt = build_commit_message_prompt(&diff, language.as_deref());

    super::start_thread_retry::run_with_runtime_recovery_retry(
        &workspace_id,
        "generate_commit_message",
        || ensure_codex_session(&workspace_id, &state, &app),
        &|| async { Ok(()) },
        || async {
            let session = resolve_codex_session_for_commit_message(&workspace_id, &state).await?;
            generate_commit_message_on_session(&workspace_id, &prompt, session, &state, &app).await
        },
    )
    .await
}
