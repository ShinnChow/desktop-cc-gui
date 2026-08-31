use super::*;


impl ClaudeSession {
    /// Kill the entire process group of `child` unconditionally — even when the
    /// group leader has already exited — so lingering descendants (MCP children,
    /// Stop hooks) that inherited the CLI's stdio pipes are terminated and their
    /// held-open pipe write ends are closed. Unlike `terminate_child_process`,
    /// this deliberately does not early-return on an already-reaped leader: the
    /// whole point is to reap the *children* that keep the turn from settling.
    #[allow(clippy::unused_async)]
    pub(super) async fn force_kill_process_group(&self, child: &mut Child) {
        let Some(pid) = child.id() else {
            return;
        };
        #[cfg(unix)]
        {
            // Negative pid targets the whole group (the leader called setpgid).
            unsafe {
                libc::kill(-(pid as libc::pid_t), libc::SIGKILL);
            }
        }
        #[cfg(windows)]
        {
            let _ = crate::utils::async_command("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .status()
                .await;
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = child.start_kill();
        }
    }

    pub(super) async fn terminate_child_process(
        &self,
        _turn_id: &str,
        child: &mut Child,
    ) -> Result<(), String> {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return Ok(());
        }

        #[cfg(target_os = "windows")]
        {
            if let Some(pid) = child.id() {
                match crate::utils::async_command("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .status()
                    .await
                {
                    Ok(status) if status.success() => {
                        let _ = child.wait().await;
                        return Ok(());
                    }
                    Ok(status) => {
                        if matches!(child.try_wait(), Ok(Some(_))) {
                            return Ok(());
                        }
                        log::warn!(
                            "[claude] taskkill failed for turn={} pid={} status={}",
                            _turn_id,
                            pid,
                            status
                        );
                    }
                    Err(error) => {
                        log::warn!(
                            "[claude] taskkill errored for turn={} pid={}: {}",
                            _turn_id,
                            pid,
                            error
                        );
                    }
                }
            }
        }

        #[cfg(unix)]
        {
            if let Some(pid) = child.id() {
                let process_group_id = pid as libc::pid_t;
                let terminate_status = unsafe { libc::kill(-process_group_id, libc::SIGTERM) };
                if terminate_status != 0 {
                    let error = std::io::Error::last_os_error();
                    if error.raw_os_error() != Some(libc::ESRCH) {
                        log::warn!(
                            "[claude] killpg(SIGTERM) failed for turn={} pgid={}: {}",
                            _turn_id,
                            process_group_id,
                            error
                        );
                    }
                } else {
                    sleep(Duration::from_millis(150)).await;
                }

                if matches!(child.try_wait(), Ok(Some(_))) {
                    let _ = child.wait().await;
                    return Ok(());
                }

                let kill_status = unsafe { libc::kill(-process_group_id, libc::SIGKILL) };
                if kill_status != 0 {
                    let error = std::io::Error::last_os_error();
                    if error.raw_os_error() != Some(libc::ESRCH) {
                        log::warn!(
                            "[claude] killpg(SIGKILL) failed for turn={} pgid={}: {}",
                            _turn_id,
                            process_group_id,
                            error
                        );
                    }
                }

                if matches!(child.try_wait(), Ok(Some(_))) {
                    let _ = child.wait().await;
                    return Ok(());
                }
            }
        }

        if let Err(error) = child.kill().await {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return Ok(());
            }
            return Err(format!("Failed to kill process: {}", error));
        }
        if matches!(child.try_wait(), Ok(Some(_))) {
            return Ok(());
        }
        let _ = child.wait().await;
        Ok(())
    }

    /// Interrupt the current operation
    pub async fn interrupt(&self) -> Result<(), String> {
        // Set interrupted flag BEFORE killing so send_message() knows this was intentional
        self.interrupted.store(true, Ordering::SeqCst);
        let children: Vec<(String, Child)> = {
            let mut active = self.active_processes.lock().await;
            active.drain().collect()
        };
        let mut first_terminate_error: Option<String> = None;
        let mut failed_children = Vec::new();
        for (turn_id, mut child) in children {
            if let Err(error) = self.terminate_child_process(&turn_id, &mut child).await {
                log::warn!(
                    "[claude] interrupt failed to terminate child for turn={}: {}",
                    turn_id,
                    error
                );
                if first_terminate_error.is_none() {
                    first_terminate_error = Some(error.clone());
                }
                failed_children.push((turn_id, child));
            } else {
                self.clear_turn_ephemeral_state(&turn_id);
            }
        }
        if !failed_children.is_empty() {
            let mut active = self.active_processes.lock().await;
            active.extend(failed_children);
            return Err(first_terminate_error
                .unwrap_or_else(|| "Failed to terminate Claude child process".to_string()));
        }
        // Clean up tool tracking state that would otherwise leak from interrupted turns.
        // Use unwrap_or_else to still clear even if the mutex was poisoned by a panic.
        self.tool_name_by_id
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.tool_input_by_id
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.tool_id_by_block_index
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.pending_tools
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.last_emitted_text_by_turn
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.emitted_runtime_model_by_turn
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.user_input_notify_by_turn
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.user_input_answer_by_turn
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.user_input_request_id_by_turn
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.thread_id_by_turn
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.pending_user_input_resume_diagnostic_by_turn
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.pending_user_inputs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.provider_env_by_turn
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        Ok(())
    }

    /// Interrupt a single turn without affecting other concurrent turns.
    pub async fn interrupt_turn(&self, turn_id: &str) -> Result<(), String> {
        self.interrupted.store(true, Ordering::SeqCst);
        let mut child = {
            let mut active = self.active_processes.lock().await;
            active.remove(turn_id)
        };
        if let Some(child_proc) = child.as_mut() {
            if let Err(error) = self.terminate_child_process(turn_id, child_proc).await {
                if let Some(child) = child {
                    self.active_processes
                        .lock()
                        .await
                        .insert(turn_id.to_string(), child);
                }
                return Err(error);
            }
        }
        self.clear_turn_ephemeral_state(turn_id);
        Ok(())
    }
}
