use crate::backend::app_server::WorkspaceSession;
use crate::types::WorkspaceEntry;

use super::gates::{RuntimeAcquireDisposition, RuntimeAcquireToken};
use super::manager::RuntimeManager;

#[derive(Debug, Clone)]
pub(crate) struct EvictionCandidate {
    pub(super) engine: String,
    pub(super) workspace_id: String,
    pub(super) reason: String,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RuntimeLifecycleCoordinator<'a> {
    manager: &'a RuntimeManager,
}

impl<'a> RuntimeLifecycleCoordinator<'a> {
    pub(super) fn new(manager: &'a RuntimeManager) -> Self {
        Self { manager }
    }

    pub(crate) async fn acquire_or_retry(
        &self,
        engine: &str,
        workspace_id: &str,
        source: &str,
        automatic_recovery: bool,
        timeout_error: &str,
    ) -> Result<RuntimeAcquireDisposition, String> {
        self.manager
            .begin_runtime_acquire_or_retry(
                engine,
                workspace_id,
                source,
                automatic_recovery,
                timeout_error,
            )
            .await
    }

    pub(crate) async fn record_acquiring(
        &self,
        entry: &WorkspaceEntry,
        engine: &str,
        source: &str,
    ) {
        self.manager.record_starting(entry, engine, source).await;
    }

    pub(crate) async fn record_active(&self, session: &WorkspaceSession, source: &str) {
        self.manager.record_ready(session, source).await;
    }

    pub(crate) async fn record_stopping(&self, engine: &str, workspace_id: &str) {
        self.manager.record_stopping(engine, workspace_id).await;
    }

    pub(crate) async fn record_recovering_failure(
        &self,
        engine: &str,
        workspace_id: &str,
        source: &str,
        error: &str,
    ) -> Result<(), String> {
        self.manager
            .record_recovery_failure_with_backoff(engine, workspace_id, source, error)
            .await
    }

    pub(crate) async fn record_recovered(&self, engine: &str, workspace_id: &str) {
        self.manager
            .record_recovery_success(engine, workspace_id)
            .await;
    }

    pub(crate) async fn record_quarantine_probe(
        &self,
        engine: &str,
        workspace_id: &str,
        source: &str,
    ) -> Result<(), String> {
        self.manager
            .ensure_recovery_ready(engine, workspace_id)
            .await?;
        self.manager
            .note_guard_event(
                engine,
                workspace_id,
                source,
                "reacquire-after-stopping-race",
            )
            .await;
        Ok(())
    }

    pub(crate) async fn finish_acquire(&self, token: &RuntimeAcquireToken) {
        self.manager.finish_runtime_acquire(token).await;
    }
}
