mod capture_script;
mod platform;
mod toolbar;
mod types;

use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{
    webview::{NewWindowResponse, WebviewBuilder},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
};

use crate::state::AppState;

use toolbar::{
    browser_element_selector_script, browser_element_selector_stop_script,
    handle_browser_toolbar_navigation, spawn_browser_toolbar_injection,
};
pub(crate) use types::*;

mod capture;
mod commands_actions;
mod commands_query;
mod commands_sessions;
mod commands_snapshot;
mod commands_webview;
mod diagnostics;
mod routing;
mod snapshot;
mod state;
mod tab_context_menu;
mod url_validation;
mod webview;

pub(crate) use capture::*;
pub(crate) use commands_actions::*;
pub(crate) use commands_query::*;
pub(crate) use commands_sessions::*;
pub(crate) use commands_snapshot::*;
pub(crate) use commands_webview::*;
pub(crate) use diagnostics::*;
pub(crate) use routing::*;
pub(crate) use snapshot::*;
pub(crate) use state::*;
pub(crate) use tab_context_menu::*;
pub(crate) use url_validation::*;
pub(crate) use webview::*;

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
