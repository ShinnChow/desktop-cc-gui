use std::collections::HashMap;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio::time::timeout;

use super::run_metadata::{extract_json_value, sanitize_run_worktree_name};
use super::session_runtime::ensure_codex_session;
use super::thread_lifecycle::record_hidden_codex_helper_thread;
use crate::backend::events::AppServerEvent;
use crate::remote_backend;
use crate::shared::thread_titles_core;
use crate::state::AppState;

#[tauri::command]
pub(crate) async fn list_thread_titles(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<HashMap<String, String>, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let value = remote_backend::call_remote(
            &*state,
            app,
            "list_thread_titles",
            json!({ "workspaceId": workspace_id }),
        )
        .await?;
        return serde_json::from_value(value)
            .map_err(|error| format!("Invalid thread titles payload: {error}"));
    }

    thread_titles_core::list_thread_titles_core(&state.workspaces, workspace_id).await
}

#[tauri::command]
pub(crate) async fn set_thread_title(
    workspace_id: String,
    thread_id: String,
    title: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let value = remote_backend::call_remote(
            &*state,
            app,
            "set_thread_title",
            json!({
                "workspaceId": workspace_id,
                "threadId": thread_id,
                "title": title,
            }),
        )
        .await?;
        return value
            .as_str()
            .map(|text| text.to_string())
            .ok_or_else(|| "Invalid set_thread_title response".to_string());
    }

    thread_titles_core::upsert_thread_title_core(&state.workspaces, workspace_id, thread_id, title)
        .await
}

#[tauri::command]
pub(crate) async fn rename_thread_title_key(
    workspace_id: String,
    old_thread_id: String,
    new_thread_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        remote_backend::call_remote(
            &*state,
            app,
            "rename_thread_title_key",
            json!({
                "workspaceId": workspace_id,
                "oldThreadId": old_thread_id,
                "newThreadId": new_thread_id,
            }),
        )
        .await?;
        return Ok(());
    }

    thread_titles_core::rename_thread_title_core(
        &state.workspaces,
        workspace_id,
        old_thread_id,
        new_thread_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn generate_thread_title(
    workspace_id: String,
    thread_id: String,
    user_message: String,
    preferred_language: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let value = remote_backend::call_remote(
            &*state,
            app,
            "generate_thread_title",
            json!({
                "workspaceId": workspace_id,
                "threadId": thread_id,
                "userMessage": user_message,
                "preferredLanguage": preferred_language,
            }),
        )
        .await?;
        return value
            .as_str()
            .map(|text| text.to_string())
            .ok_or_else(|| "Invalid generate_thread_title response".to_string());
    }

    ensure_codex_session(&workspace_id, &state, &app).await?;

    let cleaned_message = user_message.trim();
    if cleaned_message.is_empty() {
        return Err("Message is required to generate title".to_string());
    }

    let language_instruction = match preferred_language
        .unwrap_or_else(|| "en".to_string())
        .trim()
        .to_lowercase()
        .as_str()
    {
        "zh" | "zh-cn" | "zh-hans" | "chinese" => "Output language: Simplified Chinese.",
        _ => "Output language: English.",
    };

    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&workspace_id)
            .ok_or("workspace not connected")?
            .clone()
    };

    let prompt = format!(
        "Generate a concise title for a coding chat thread from the first user message. \
Return only the title text, no quotes, no punctuation-only output, no markdown. \
Keep it between 3 and 8 words.\n\
{language_instruction}\n\nFirst user message:\n{cleaned_message}"
    );

    let thread_start_result = session
        .send_request(
            "thread/start",
            json!({
                "cwd": session.entry.path,
                "approvalPolicy": "never"
            }),
        )
        .await?;

    if let Some(error) = thread_start_result.get("error") {
        let message = error
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("Unknown error starting title thread");
        return Err(message.to_string());
    }

    let helper_thread_id = thread_start_result
        .get("result")
        .and_then(|result| result.get("threadId"))
        .or_else(|| {
            thread_start_result
                .get("result")
                .and_then(|result| result.get("thread"))
                .and_then(|thread| thread.get("id"))
        })
        .or_else(|| thread_start_result.get("threadId"))
        .or_else(|| {
            thread_start_result
                .get("thread")
                .and_then(|thread| thread.get("id"))
        })
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            format!(
                "Failed to get threadId from thread/start response: {:?}",
                thread_start_result
            )
        })?
        .to_string();
    record_hidden_codex_helper_thread(
        &state,
        &workspace_id,
        &helper_thread_id,
        "title-generation",
        "threads",
    )
    .await;

    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id: workspace_id.clone(),
            message: json!({
                "method": "codex/backgroundThread",
                "params": {
                    "threadId": helper_thread_id,
                    "action": "hide"
                }
            }),
        },
    );

    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.insert(helper_thread_id.clone(), tx);
    }

    let turn_start_result = session
        .send_request(
            "turn/start",
            json!({
                "threadId": helper_thread_id,
                "input": [{ "type": "text", "text": prompt }],
                "cwd": session.entry.path,
                "approvalPolicy": "never",
                "sandboxPolicy": { "type": "readOnly" },
            }),
        )
        .await;

    let turn_start_result = match turn_start_result {
        Ok(result) => result,
        Err(error) => {
            {
                let mut callbacks = session.background_thread_callbacks.lock().await;
                callbacks.remove(&helper_thread_id);
            }
            let _ = session
                .send_request(
                    "thread/archive",
                    json!({ "threadId": helper_thread_id.as_str() }),
                )
                .await;
            return Err(error);
        }
    };

    if let Some(error) = turn_start_result.get("error") {
        let message = error
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("Unknown error starting title generation turn")
            .to_string();
        {
            let mut callbacks = session.background_thread_callbacks.lock().await;
            callbacks.remove(&helper_thread_id);
        }
        let _ = session
            .send_request(
                "thread/archive",
                json!({ "threadId": helper_thread_id.as_str() }),
            )
            .await;
        return Err(message);
    }

    let mut generated = String::new();
    let collect_result = timeout(Duration::from_secs(30), async {
        while let Some(event) = rx.recv().await {
            let method = event
                .get("method")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            match method {
                "item/agentMessage/delta" => {
                    if let Some(delta) = event
                        .get("params")
                        .and_then(|params| params.get("delta"))
                        .and_then(|value| value.as_str())
                    {
                        generated.push_str(delta);
                    }
                }
                "turn/completed" => break,
                "turn/error" => {
                    let message = event
                        .get("params")
                        .and_then(|params| params.get("error"))
                        .and_then(|value| value.as_str())
                        .unwrap_or("Unknown error during title generation");
                    return Err(message.to_string());
                }
                _ => {}
            }
        }
        Ok(())
    })
    .await;

    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.remove(&helper_thread_id);
    }

    let _ = session
        .send_request("thread/archive", json!({ "threadId": helper_thread_id }))
        .await;

    match collect_result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => return Err(error),
        Err(_) => return Err("Timeout waiting for thread title generation".to_string()),
    }

    let normalized = generated
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches('"')
        .to_string();
    if normalized.is_empty() {
        return Err("No thread title was generated".to_string());
    }

    let saved = thread_titles_core::upsert_thread_title_core(
        &state.workspaces,
        workspace_id,
        thread_id,
        normalized,
    )
    .await?;

    Ok(saved)
}

#[tauri::command]
pub(crate) async fn generate_run_metadata(
    workspace_id: String,
    prompt: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "generate_run_metadata",
            json!({ "workspaceId": workspace_id, "prompt": prompt }),
        )
        .await;
    }

    let cleaned_prompt = prompt.trim();
    if cleaned_prompt.is_empty() {
        return Err("Prompt is required.".to_string());
    }

    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&workspace_id)
            .ok_or("workspace not connected")?
            .clone()
    };

    let title_prompt = format!(
        "You create concise run metadata for a coding task.\n\
Return ONLY a JSON object with keys:\n\
- title: short, clear, 3-7 words, Title Case\n\
- worktreeName: lower-case, kebab-case slug prefixed with one of: \
feat/, fix/, chore/, test/, docs/, refactor/, perf/, build/, ci/, style/.\n\
\n\
Choose fix/ when the task is a bug fix, error, regression, crash, or cleanup. \
Use the closest match for chores/tests/docs/refactors/perf/build/ci/style. \
Otherwise use feat/.\n\
\n\
Examples:\n\
{{\"title\":\"Fix Login Redirect Loop\",\"worktreeName\":\"fix/login-redirect-loop\"}}\n\
{{\"title\":\"Add Workspace Home View\",\"worktreeName\":\"feat/workspace-home\"}}\n\
{{\"title\":\"Update Lint Config\",\"worktreeName\":\"chore/update-lint-config\"}}\n\
{{\"title\":\"Add Coverage Tests\",\"worktreeName\":\"test/add-coverage-tests\"}}\n\
\n\
Task:\n{cleaned_prompt}"
    );

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
    record_hidden_codex_helper_thread(&state, &workspace_id, &thread_id, "run-metadata", "tasks")
        .await;

    // Hide background helper threads from the sidebar, even if a thread/started event leaked.
    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id: workspace_id.clone(),
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
        "input": [{ "type": "text", "text": title_prompt }],
        "cwd": session.entry.path,
        "approvalPolicy": "never",
        "sandboxPolicy": { "type": "readOnly" },
    });
    let turn_result = session.send_request("turn/start", turn_params).await;
    let turn_result = match turn_result {
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

    let mut response_text = String::new();
    let timeout_duration = Duration::from_secs(60);
    let collect_result = timeout(timeout_duration, async {
        while let Some(event) = rx.recv().await {
            let method = event.get("method").and_then(|m| m.as_str()).unwrap_or("");
            match method {
                "item/agentMessage/delta" => {
                    if let Some(params) = event.get("params") {
                        if let Some(delta) = params.get("delta").and_then(|d| d.as_str()) {
                            response_text.push_str(delta);
                        }
                    }
                }
                "turn/completed" => break,
                "turn/error" => {
                    let error_msg = event
                        .get("params")
                        .and_then(|p| p.get("error"))
                        .and_then(|e| e.as_str())
                        .unwrap_or("Unknown error during metadata generation");
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
        Err(_) => return Err("Timeout waiting for metadata generation".to_string()),
    }

    let trimmed = response_text.trim();
    if trimmed.is_empty() {
        return Err("No metadata was generated".to_string());
    }

    let json_value =
        extract_json_value(trimmed).ok_or_else(|| "Failed to parse metadata JSON".to_string())?;
    let title = json_value
        .get("title")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Missing title in metadata".to_string())?;
    let worktree_name = json_value
        .get("worktreeName")
        .or_else(|| json_value.get("worktree_name"))
        .and_then(|v| v.as_str())
        .map(|v| sanitize_run_worktree_name(v))
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Missing worktree name in metadata".to_string())?;

    Ok(json!({
        "title": title,
        "worktreeName": worktree_name
    }))
}
