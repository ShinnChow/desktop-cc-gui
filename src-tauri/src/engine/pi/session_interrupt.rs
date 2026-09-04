use super::*;

impl PiSession {
    pub async fn interrupt(&self) -> Result<(), String> {
        // Abort every resident that currently has a run. Other idle PI tabs
        // keep their process; empty interrupt must not sleep 2s per tab.
        let active: Vec<PiResident> = {
            let guard = self.residents.read().await;
            let mut out = Vec::new();
            for resident in guard.values() {
                if resident.run.read().await.is_some() || resident.in_flight.load(Ordering::SeqCst)
                {
                    out.push(resident.clone());
                }
            }
            out
        };
        for resident in active {
            if !resident.client.is_alive().await {
                continue;
            }
            if let Some(run) = resident.run.write().await.as_mut() {
                run.abort_requested = true;
            }
            if let Err(error) = resident.client.abort().await {
                log::warn!("[pi/rpc] abort command failed: {error}");
            }
            tokio::time::sleep(PI_RPC_ABORT_SETTLE_GRACE).await;
            if resident.run.read().await.is_some() {
                log::warn!("[pi/rpc] abort did not settle within grace; killing resident");
                resident.client.kill().await;
            }
        }
        let mut active = self.active_processes.lock().await;
        let mut interrupted = self.interrupted_turns.lock().await;
        let mut killed_turn_ids = Vec::new();
        let mut errors = Vec::new();
        for (turn_id, process) in active.iter_mut() {
            match process.child.kill().await {
                Ok(()) => {
                    interrupted.insert(turn_id.clone());
                    killed_turn_ids.push(turn_id.clone());
                }
                // Keep the failed entry in the map so Drop can retry the kill.
                Err(error) => errors.push(format!("{turn_id}: {error}")),
            }
        }
        for turn_id in &killed_turn_ids {
            active.remove(turn_id);
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "failed to interrupt {} pi turn(s): {}",
                errors.len(),
                errors.join("; ")
            ))
        }
    }

    pub async fn interrupt_turn(&self, turn_id: &str) -> Result<(), String> {
        let resident = {
            let guard = self.residents.read().await;
            let mut found = None;
            for resident in guard.values() {
                let run_guard = resident.run.read().await;
                let Some(run) = run_guard.as_ref() else {
                    continue;
                };
                if run.main_turn_id == turn_id
                    || run.attached_turn_ids.iter().any(|id| id == turn_id)
                {
                    found = Some(resident.clone());
                    break;
                }
            }
            if found.is_none() {
                for resident in guard.values() {
                    let flying = resident.in_flight_turn.lock().await;
                    if flying.as_deref() == Some(turn_id) {
                        found = Some(resident.clone());
                        break;
                    }
                }
            }
            found
        };
        if let Some(resident) = resident {
            if resident.client.is_alive().await {
                if let Some(run) = resident.run.write().await.as_mut() {
                    run.abort_requested = true;
                }
                if let Err(error) = resident.client.abort().await {
                    log::warn!("[pi/rpc] abort command failed: {error}");
                }
                tokio::time::sleep(PI_RPC_ABORT_SETTLE_GRACE).await;
                if resident.run.read().await.is_some() {
                    resident.client.kill().await;
                }
                self.interrupted_turns
                    .lock()
                    .await
                    .insert(turn_id.to_string());
                return Ok(());
            }
        }
        let mut active = self.active_processes.lock().await;
        let Some(process) = active.get_mut(turn_id) else {
            return Ok(());
        };
        let kill_result = process
            .child
            .kill()
            .await
            .map_err(|e| format!("Failed to kill process: {e}"));
        let mut interrupted_turns = self.interrupted_turns.lock().await;
        apply_interrupt_result(&mut active, &mut interrupted_turns, turn_id, kill_result)
    }

    #[allow(dead_code)]
    pub async fn active_process_snapshots(
        &self,
        sampled_at_ms: u64,
    ) -> Vec<PiActiveProcessSnapshot> {
        let active = self.active_processes.lock().await;
        active
            .values()
            .filter_map(|process| process.snapshot(sampled_at_ms))
            .collect()
    }
}
