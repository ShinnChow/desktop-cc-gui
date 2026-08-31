//! PI RPC session commands (`pi --mode rpc` resident), split from `commands.rs`.

use super::*;

// ===== PI RPC session commands (`pi --mode rpc` resident) =====
//
// These expose the RPC-only command surface (stats / compact / fork / tree).
// They never fall back to print-json: the data only exists on the resident.

/// OpenSpec change：fix-orphan-turn-during-backend-unavailability（F3）。
/// detached PI send 的统一驱动：`Err` 只记日志（pi.rs `send_message` 内部
/// 失败路径已 `emit_error`）；panic 捕获后经 `emit_error` 补发 TurnError，
/// 保证 turn 必有回执，防止静默孤儿（前端 F1 看门狗之外的后端侧兜底）。
pub(crate) async fn drive_detached_pi_send<F>(
    turn_id: &str,
    emit_error: impl Fn(&str, String),
    send: F,
) where
    F: std::future::Future<Output = Result<String, String>>,
{
    let wrapped = std::panic::AssertUnwindSafe(send);
    match futures_util::FutureExt::catch_unwind(wrapped).await {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => log::error!("PI send_message failed: {e}"),
        Err(panic) => {
            let panic_text = panic
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown panic".to_string());
            log::error!("PI send_message panicked: {panic_text}");
            emit_error(turn_id, format!("pi send task panicked: {panic_text}"));
        }
    }
}

async fn resolve_pi_session_for_rpc_commands(
    state: &State<'_, AppState>,
    workspace_id: &str,
    provider_profile_id: Option<&str>,
) -> Result<std::sync::Arc<crate::engine::pi::PiSession>, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(workspace_id)
            .map(|w| std::path::PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let effective_provider_profile_id =
        crate::session_management::resolve_engine_provider_profile_id(
            state.storage_path.as_path(),
            workspace_id,
            None,
            "pi",
            provider_profile_id,
        )?;
    let provider_launch_profile =
        crate::engine::pi_provider_profile::resolve_pi_provider_launch_profile(
            workspace_id,
            effective_provider_profile_id.as_deref(),
            None,
        )?;
    let manager = &state.engine_manager;
    Ok(manager
        .get_or_create_pi_session_for_runtime(
            workspace_id,
            &workspace_path,
            &provider_launch_profile.runtime_key,
            provider_launch_profile.home_dir.as_deref(),
        )
        .await)
}

#[tauri::command]
pub async fn pi_get_session_stats(
    workspace_id: String,
    session_id: Option<String>,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "pi_get_session_stats",
            json!({ "workspaceId": workspace_id, "sessionId": session_id, "providerProfileId": provider_profile_id }),
        )
        .await;
    }
    let session =
        resolve_pi_session_for_rpc_commands(&state, &workspace_id, provider_profile_id.as_deref())
            .await?;
    let client = session
        .rpc_client_for_commands(session_id.as_deref())
        .await?;
    client.get_session_stats().await
}

#[tauri::command]
pub async fn pi_compact(
    workspace_id: String,
    session_id: Option<String>,
    custom_instructions: Option<String>,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "pi_compact",
            json!({
                "workspaceId": workspace_id,
                "sessionId": session_id,
                "customInstructions": custom_instructions,
                "providerProfileId": provider_profile_id,
            }),
        )
        .await;
    }
    let session =
        resolve_pi_session_for_rpc_commands(&state, &workspace_id, provider_profile_id.as_deref())
            .await?;
    session
        .with_exclusive_rpc_command(session_id.as_deref(), |client| async move {
            client.compact(custom_instructions.as_deref()).await
        })
        .await
}

/// fork 后身份判定：fork 成功会切换 resident 的会话文件；若 fork 前后
/// sessionFile 相同（pi 侧静默 no-op——未分叉但也没返回 cancelled/报错），
/// get_state 拿到的是源会话身份。把它当 forkedSessionId 返回会让前端把
/// 主线误登记为派生、整局从侧栏隐藏（2026-08-24 侧栏主线丢失取证）。
/// 文件未变 ⇒ 返回 None（视为未分叉）；拿不到文件信息时保持旧行为放行。
pub(crate) fn resolve_pi_forked_session_id(
    pre_session_file: Option<&str>,
    forked_state: Option<&Value>,
) -> Option<String> {
    let state = forked_state?;
    let session_id = state.get("sessionId")?.as_str()?.trim();
    if session_id.is_empty() {
        return None;
    }
    let post_file = state.get("sessionFile").and_then(Value::as_str);
    if let (Some(pre), Some(post)) = (pre_session_file, post_file) {
        if pre == post {
            log::warn!("[pi/rpc] fork returned without switching session file; treating as no-op");
            return None;
        }
    }
    Some(session_id.to_string())
}

#[tauri::command]
pub async fn pi_fork(
    workspace_id: String,
    session_id: Option<String>,
    entry_id: String,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "pi_fork",
            json!({
                "workspaceId": workspace_id,
                "sessionId": session_id,
                "entryId": entry_id,
                "providerProfileId": provider_profile_id,
            }),
        )
        .await;
    }
    let session =
        resolve_pi_session_for_rpc_commands(&state, &workspace_id, provider_profile_id.as_deref())
            .await?;
    let session_for_fork = session.clone();
    session
        .with_exclusive_rpc_command(session_id.as_deref(), move |client| {
            let session = session_for_fork;
            async move {
            let pre_state = client.get_state().await?;
            let pre_session_id = pre_state
                .get("sessionId")
                .and_then(Value::as_str)
                .map(str::to_string);
            let pre_session_file = pre_state
                .get("sessionFile")
                .and_then(Value::as_str)
                .map(str::to_string);
            let data = client.fork(&entry_id).await?;
            let forked_state = client.get_state().await.ok();
            let forked_session_id = resolve_pi_forked_session_id(
                pre_session_file.as_deref(),
                forked_state.as_ref(),
            );
            if let Some(ref path) = pre_session_file {
                if let Err(error) = client.switch_session(path).await {
                    session.restore_tracked_session_id(pre_session_id.clone()).await;
                    return Err(format!(
                        "fork created a branch but failed to switch back to the source session: {error}"
                    ));
                }
            }
            let current_session_id = session.rpc_resync_session_id(&client).await;
            Ok(json!({
                "text": data.get("text").cloned().unwrap_or(Value::Null),
                "cancelled": data.get("cancelled").and_then(Value::as_bool).unwrap_or(false),
                "sessionId": current_session_id,
                "forkedSessionId": forked_session_id,
            }))
            }
        })
        .await
}

#[tauri::command]
pub async fn pi_get_session_tree(
    workspace_id: String,
    session_id: Option<String>,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "pi_get_session_tree",
            json!({ "workspaceId": workspace_id, "sessionId": session_id, "providerProfileId": provider_profile_id }),
        )
        .await;
    }
    let session =
        resolve_pi_session_for_rpc_commands(&state, &workspace_id, provider_profile_id.as_deref())
            .await?;
    let client = session
        .rpc_client_for_commands(session_id.as_deref())
        .await?;
    // get_tree 对外统一为浅层 entries（摊平+瘦身在 pi_rpc 内完成：深会话在
    // pump 的大栈线程，浅会话在 get_tree 内），这里只需透传。
    let tree = client.get_tree().await?;
    let flattened_entries = tree
        .get("entries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    // 会话族全图：跳入分支后树仍展示 root 主线 + 所有派生 lane（不截断）。
    // fork 产生独立文件（parentSession 头指向源文件）；root 不是当前文件
    // 时，主线从磁盘只读解析（红线 21），当前 lane 仍由 RPC get_tree 提供。
    let session_file = client.get_state().await.ok().and_then(|state| {
        state
            .get("sessionFile")
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    let (root_session_id, root_entries, derived_lanes) = match session_file {
        Some(ref file) => {
            let path = std::path::Path::new(file);
            let family = crate::engine::pi_history::resolve_pi_session_family(path)
                .await
                .unwrap_or_default();
            let root = family.iter().find(|member| member.is_root);
            let root_id = root.map(|member| member.session_id.clone());
            let root_path = root.map(|member| member.session_file.clone());
            let root_entries = match root_path.as_ref().filter(|p| **p != path) {
                Some(root_file) => crate::engine::pi_history::parse_pi_session_entries(root_file)
                    .await
                    .unwrap_or_default(),
                None => Vec::new(),
            };
            let derived = crate::engine::pi_history::list_pi_derived_lanes(path)
                .await
                .unwrap_or_else(|error| {
                    log::warn!("[pi/rpc] list derived lanes failed: {error}");
                    Vec::new()
                });
            (root_id, root_entries, derived)
        }
        None => (None, Vec::new(), Vec::new()),
    };
    Ok(json!({
        "entries": flattened_entries,
        "leafId": tree.get("leafId").cloned().unwrap_or(Value::Null),
        "derivedLanes": derived_lanes,
        "rootSessionId": root_session_id,
        "rootEntries": root_entries,
    }))
}

#[tauri::command]
pub async fn pi_get_fork_messages(
    workspace_id: String,
    session_id: Option<String>,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "pi_get_fork_messages",
            json!({ "workspaceId": workspace_id, "sessionId": session_id, "providerProfileId": provider_profile_id }),
        )
        .await;
    }
    let session =
        resolve_pi_session_for_rpc_commands(&state, &workspace_id, provider_profile_id.as_deref())
            .await?;
    let client = session
        .rpc_client_for_commands(session_id.as_deref())
        .await?;
    client.get_fork_messages().await
}
