//! PI CLI engine implementation
//!
//! Headless protocol (JetBrains-aligned, spike-verified on pi 0.83):
//! `pi --print --mode json "<prompt>" [--model] [--session-id] [--thinking]`
//!
//! NDJSON event types:
//! - `session` { id }
//! - `message_update` { assistantMessageEvent: { type: text_delta|thinking_delta, delta } }
//! - `tool_execution_start` / `tool_execution_end`
//! - `message_end` (assistant snapshot / usage / errors)
//! - `agent_end` / `turn_end` with errorMessage (auth failures etc.)

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, oneshot, Mutex, RwLock};

use super::events::EngineEvent;
use super::pi_rpc::{PiRpcClient, PiRpcPumpEvent};
use super::{EngineConfig, EngineType, SendMessageParams};

#[path = "pi/at_references.rs"]
mod at_references;
#[path = "pi/background_tasks.rs"]
mod background_tasks;
#[path = "pi/diagnostics.rs"]
mod diagnostics;
#[path = "pi/gates.rs"]
mod gates;
#[path = "pi/process.rs"]
mod process;
#[path = "pi/prompt_attachments.rs"]
mod prompt_attachments;
#[path = "pi/send_options.rs"]
mod send_options;
#[path = "pi/session.rs"]
mod session;
#[path = "pi/session_interrupt.rs"]
mod session_interrupt;
#[path = "pi/session_rpc.rs"]
mod session_rpc;
#[path = "pi/session_send.rs"]
mod session_send;
#[path = "pi/stream_lines.rs"]
mod stream_lines;

pub use gates::resolve_pi_session_id_for_engine_send;
pub use process::PiActiveProcessSnapshot;
pub use session::{PiSession, PiTurnEvent};
pub(crate) use at_references::*;
pub(crate) use background_tasks::*;
pub(crate) use diagnostics::*;
pub(crate) use gates::*;
pub(crate) use process::*;
pub(crate) use prompt_attachments::*;
pub(crate) use send_options::*;
pub(crate) use session_rpc::*;
pub(crate) use stream_lines::*;

#[cfg(test)]
#[path = "pi_tests.rs"]
mod tests;
