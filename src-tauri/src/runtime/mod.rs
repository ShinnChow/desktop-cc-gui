mod acquire_boundary;
pub(crate) mod commands;
mod consts;
mod coordinator;
mod end_context;
mod entry;
mod event_sources;
mod executable_registry;
mod gates;
mod identity;
mod ledger;
mod manager;
mod pool_types;
mod process_diagnostics;
mod session_lifecycle;

#[cfg(test)]
pub(crate) use self::pool_types::RuntimeLifecycleTransition;
#[allow(unused_imports)]
pub(crate) use self::pool_types::{
    runtime_pool_summary_from_rows, RuntimeEndedRecord, RuntimeEngineObservability,
    RuntimeForegroundWorkState, RuntimeLifecycleState, RuntimePoolBudgetSnapshot,
    RuntimePoolDiagnostics, RuntimePoolRow, RuntimePoolSnapshot, RuntimeProcessDiagnostics,
    RuntimeStartupState, RuntimeState, TurnReconciliationRuntimeStatus,
    TurnReconciliationStatusQuery, TurnReconciliationStatusResponse,
    TurnReconciliationStatusSource,
};
#[allow(unused_imports)]
pub(crate) use self::session_lifecycle::stop_workspace_session_with_source;
pub(crate) use self::session_lifecycle::{
    replace_workspace_session, replace_workspace_session_with_source, stop_workspace_session,
    terminate_workspace_session, terminate_workspace_session_process,
    terminate_workspace_session_with_source,
};
#[cfg(test)]
pub(crate) use self::session_lifecycle::{
    replace_workspace_session_with_terminator, terminate_replaced_workspace_session,
};
#[allow(unused_imports)]
pub(crate) use self::coordinator::{EvictionCandidate, RuntimeLifecycleCoordinator};
#[allow(unused_imports)]
pub(crate) use self::gates::{RuntimeAcquireDisposition, RuntimeAcquireGate, RuntimeAcquireToken};
#[allow(unused_imports)]
pub(crate) use self::manager::{shutdown_managed_runtimes, RuntimeManager};

use self::consts::TERMINATE_GRACE_MILLIS;
#[cfg(test)]
use self::consts::RUNTIME_RECOVERY_MAX_CONSECUTIVE_FAILURES;
use self::entry::now_millis;
#[cfg(test)]
use self::executable_registry::ExecutableSessionState;
use self::gates::RuntimeReplacementGate;
use self::identity::normalize_engine;
#[cfg(test)]
use self::ledger::write_json_atomically;
#[cfg(test)]
use self::process_diagnostics::build_engine_observability;

#[cfg(test)]
mod recovery_tests;
#[cfg(test)]
mod tests;
