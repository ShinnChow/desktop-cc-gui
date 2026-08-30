// `local_usage.rs` is shared with the desktop Tauri app and references
// `crate::state::AppState` in command wrappers. The daemon only reuses the
// workspace-backed filesystem helpers, so a minimal stub keeps the shared
// module compilable here without pulling the full desktop app state graph.
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::backend::app_server::WorkspaceSession;
use crate::engine::EngineManager;
use crate::runtime::RuntimeManager;
use crate::types::{AppSettings, WorkspaceEntry};
use std::path::PathBuf;

#[allow(dead_code)]
pub(crate) struct AppState {
    pub(crate) workspaces: Mutex<HashMap<String, WorkspaceEntry>>,
    pub(crate) sessions: Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    pub(crate) app_settings: Mutex<AppSettings>,
    pub(crate) storage_path: PathBuf,
    pub(crate) settings_path: PathBuf,
    pub(crate) runtime_manager: Arc<RuntimeManager>,
    pub(crate) engine_manager: Arc<EngineManager>,
}

impl AppState {
    #[allow(dead_code)]
    pub(crate) async fn sync_engine_configs_from_settings(&self) {}
}

