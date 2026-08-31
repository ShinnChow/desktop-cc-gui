//! Engine status detection
//!
//! Detects installed CLI tools and their capabilities.

use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::process::Command;
use tokio::time::timeout;

use super::pi_rpc::PiRpcClient;
use super::{disabled_engine_status, EngineFeatures, EngineStatus, EngineType, ModelInfo};
use crate::app_paths;
use crate::backend::app_server::{
    build_codex_path_env, claude_cached_version_text, find_claude_code_binary, find_cli_binary,
    invalidate_environment_resolution_caches,
};
use crate::backend::app_server_cli::resolve_safe_opencode_binary;

/// Timeout for CLI commands
const DETECTION_TIMEOUT: Duration = Duration::from_secs(10);

/// OpenCode model listing can be significantly slower than version probes.
const OPENCODE_MODELS_TIMEOUT: Duration = Duration::from_secs(30);

const GENERATED_MODEL_CATALOG_JSON: &str =
    include_str!("../../../src/features/models/generatedModelCatalog.json");

static OPENCODE_RUNTIME_MODEL_CATALOG: OnceLock<RwLock<Vec<ModelInfo>>> = OnceLock::new();

#[path = "status/catalog.rs"]
mod catalog;
#[path = "status/probe.rs"]
mod probe;
#[path = "status/claude.rs"]
mod claude;
#[path = "status/codex.rs"]
mod codex;
#[path = "status/opencode.rs"]
mod opencode;
#[path = "status/gemini.rs"]
mod gemini;
#[path = "status/kimi.rs"]
mod kimi;
#[path = "status/grok.rs"]
mod grok;
#[path = "status/pi.rs"]
mod pi;
#[path = "status/qoder.rs"]
mod qoder;
#[path = "status/orchestration.rs"]
mod orchestration;

pub(crate) use catalog::*;
pub(crate) use probe::*;
pub use claude::*;
pub use codex::*;
pub use opencode::*;
pub use gemini::*;
pub use kimi::*;
pub use grok::*;
pub use pi::*;
pub use qoder::*;
pub use orchestration::*;

#[cfg(test)]
#[path = "status_tests.rs"]
mod tests;
