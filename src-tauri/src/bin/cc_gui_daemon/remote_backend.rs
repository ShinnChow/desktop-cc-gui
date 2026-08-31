use serde_json::Value;
use tauri::AppHandle;

use crate::state::AppState;

pub(crate) async fn is_remote_mode(_state: &AppState) -> bool {
    false
}

pub(crate) async fn call_remote(
    _state: &AppState,
    _app: AppHandle,
    _method: &str,
    _params: Value,
) -> Result<Value, String> {
    Err("remote backend is not available in daemon".to_string())
}

