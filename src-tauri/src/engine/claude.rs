//! Claude Code engine implementation
//!
//! Handles Claude Code CLI execution via `claude -p` (print mode) with
//! streaming JSON output.

use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, Mutex, Notify, RwLock};
#[cfg(unix)]
use tokio::time::sleep;

use super::claude_message_content::{build_message_content, format_ask_user_answer};
use super::events::EngineEvent;
use super::{EngineConfig, EngineType, SendMessageParams};

#[path = "claude/approval.rs"]
mod approval;
#[path = "claude/askuser_mcp.rs"]
mod askuser_mcp;
#[path = "claude/curated_skill_prompt.rs"]
mod curated_skill_prompt;
#[path = "claude/event_conversion.rs"]
mod event_conversion;
mod lifecycle;
#[path = "claude/manager.rs"]
mod manager;
#[path = "claude/native_skill_mirror.rs"]
mod native_skill_mirror;
#[path = "claude/provider_profile.rs"]
pub(crate) mod provider_profile;
#[path = "claude_stream_helpers.rs"]
mod stream_helpers;
mod user_input;
use approval::{
    classify_claude_mode_blocked_tool, command_can_apply_as_local_file_action,
    extract_claude_command_string, looks_like_claude_permission_denial_message,
    ClaudeModeBlockedKind, SyntheticApprovalSummaryEntry,
};
#[cfg(test)]
use approval::{
    format_synthetic_approval_completion_text, format_synthetic_approval_resume_message,
    SYNTHETIC_APPROVAL_RESUME_MARKER_PREFIX,
};
#[cfg(test)]
#[path = "claude/tests_stream.rs"]
mod tests_stream;
#[cfg(test)]
use command_build::ClaudeProviderSettingsOverride;
pub use askuser_mcp::{global as askuser_mcp_global, AskUserMcpServer};
// `init_global` is re-exported for the Tauri lib entrypoint (lib.rs) and tests; the
// cc_gui_daemon binary compiles this module but never starts the askuser MCP server,
// so the re-export is unused in that build — allow it rather than trip `-D warnings`.
#[allow(unused_imports)]
pub use askuser_mcp::init_global as init_askuser_mcp_global;
pub use manager::ClaudeSessionManager;
pub(crate) use provider_profile::resolve_claude_provider_launch_profile;
// Used by the Tauri lib entrypoint and tests; the daemon compiles this module
// but reads the constant via a different path, so allow the unused re-export.
#[allow(unused_imports)]
pub(crate) use provider_profile::CLAUDE_LOCAL_PROVIDER_PROFILE_ID;
#[cfg(test)]
use stream_helpers::extract_text_from_content;
#[cfg(test)]
use stream_helpers::extract_tool_result_text;
use stream_helpers::{
    can_force_kill_for_grace, extract_background_task_id, extract_claude_tool_input,
    extract_claude_tool_name, extract_result_text, extract_string_field, extract_task_started_id,
    extract_terminal_task_release_id, is_claude_stream_control_line,
    looks_like_claude_runtime_error, merge_text_chunks, parse_claude_stream_json_line,
    tool_input_signature, try_register_background_task_id, try_release_background_task_id,
};

#[path = "claude/command_build.rs"]
mod command_build;
#[path = "claude/interrupt.rs"]
mod interrupt;
#[path = "claude/send_attempt.rs"]
mod send_attempt;
#[path = "claude/session_state.rs"]
mod session_state;
#[path = "claude/tool_tracking.rs"]
mod tool_tracking;
use session_state::ActiveTurnGuard;
pub use session_state::ClaudeSession;
// `ClaudeTurnEvent` is consumed structurally (via `subscribe()` receivers) and by
// tests; non-test builds never name the type through this re-export — allow it,
// mirroring the askuser_mcp re-export allows above.
#[allow(unused_imports)]
pub use session_state::ClaudeTurnEvent;
pub(crate) use session_state::{ClaudeAskUserQuestionResumeDiagnosticSink, ClaudeStreamTiming};
// The diagnostic payload is only consumed via the sink closure's inferred
// parameter type; no caller names the struct through this re-export.
#[allow(unused_imports)]
pub(crate) use session_state::ClaudeAskUserQuestionResumeDiagnostic;

#[derive(Debug, Clone, Default)]
struct ClaudeStreamStartupTiming {
    process_spawn_started_at_ms: Option<u64>,
    process_spawned_at_ms: Option<u64>,
    stdin_write_started_at_ms: Option<u64>,
    stdin_closed_at_ms: Option<u64>,
    turn_started_at_ms: Option<u64>,
    first_stdout_line_at_ms: Option<u64>,
    first_valid_stream_event_at_ms: Option<u64>,
    first_text_delta_at_ms: Option<u64>,
}

impl ClaudeStreamStartupTiming {
    fn to_stream_timing(
        &self,
        stdout_received_at_ms: Option<u64>,
        session_emitted_at_ms: u64,
    ) -> ClaudeStreamTiming {
        ClaudeStreamTiming {
            stdout_received_at_ms,
            process_spawn_started_at_ms: self.process_spawn_started_at_ms,
            process_spawned_at_ms: self.process_spawned_at_ms,
            stdin_write_started_at_ms: self.stdin_write_started_at_ms,
            stdin_closed_at_ms: self.stdin_closed_at_ms,
            turn_started_at_ms: self.turn_started_at_ms,
            first_stdout_line_at_ms: self.first_stdout_line_at_ms,
            first_valid_stream_event_at_ms: self.first_valid_stream_event_at_ms,
            first_text_delta_at_ms: self.first_text_delta_at_ms,
            session_emitted_at_ms,
        }
    }
}

/// Mid-turn 看门狗判定结果。
/// OpenSpec change：add-claude-mid-turn-stream-idle-watchdog。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MidTurnIdleAction {
    Wait,
    Kill,
}

const RETRYABLE_PROMPT_TOO_LONG_PREFIX: &str = "__claude_retryable_prompt_too_long__:";
const AUTO_COMPACT_SIGNAL_SOURCE: &str = "auto_compact_retry";
const CLAUDE_TEXT_DELTA_COALESCE_WINDOW_MS: u64 = 32;
const CLAUDE_NON_INTERACTIVE_ENV: &str = "CLAUDE_NON_INTERACTIVE";
const CLAUDE_CONTEXT_BOOTSTRAP_SYSTEM_PROMPT: &str =
    "Import the supplied prior context into this session. Do not use tools. Follow the user's acceptance instruction exactly.";
#[cfg(not(test))]
const CLAUDE_STREAM_FIRST_EVENT_TIMEOUT: Duration = Duration::from_secs(90);
#[cfg(test)]
const CLAUDE_STREAM_FIRST_EVENT_TIMEOUT: Duration = Duration::from_secs(10);
// Mid-turn（首事件后、`result` 前、无后台 Agent 任务）读循环历史上无界——中转
// 代理（如 CCSwitch）断流/半开 TCP 不产生 EOF 时 turn 永远挂起：无 TurnError、
// 线程永远「生成中」、后续发送被堵（0.9.3 测试版用户反馈「后续轮渲染不出来」）。
// 看门狗按 STEP 步进检查静音时长；合法静音 ceiling 为 MCP/工具 1800s+ 余量
// （CLI 侧超时自结算），AskUserQuestion 等用户输入期间挂起硬上限。
// OpenSpec change：add-claude-mid-turn-stream-idle-watchdog。
#[cfg(not(test))]
const CLAUDE_STREAM_MID_TURN_IDLE_STEP: Duration = Duration::from_secs(120);
#[cfg(test)]
const CLAUDE_STREAM_MID_TURN_IDLE_STEP: Duration = Duration::from_secs(1);
/// prod 硬上限秒数（独立常量以便测试断言 prod 值不受 cfg(test) 覆盖影响）：
/// ASK_USER_QUESTION_TIMEOUT_SECS(1800) + 300s 余量——合法静音（工具/MCP）由
/// CLI 侧超时自结算（≤1800s+），超过即判定代理断流/CLI 卡死。
const CLAUDE_STREAM_MID_TURN_IDLE_HARD_CAP_PROD_SECS: u64 = ASK_USER_QUESTION_TIMEOUT_SECS + 300;
#[cfg(not(test))]
const CLAUDE_STREAM_MID_TURN_IDLE_HARD_CAP: Duration =
    Duration::from_secs(CLAUDE_STREAM_MID_TURN_IDLE_HARD_CAP_PROD_SECS);
// test 值必须超过既有 fake-script fixture 的合法 mid-turn 静音（最长 sleep 7s），
// 否则看门狗误杀「正常长 turn」测试。Kill 路径的循环级验证由纯函数单测承担。
#[cfg(test)]
const CLAUDE_STREAM_MID_TURN_IDLE_HARD_CAP: Duration = Duration::from_secs(30);
const CLAUDE_STREAM_DIAGNOSTIC_SAMPLE_LIMIT: usize = 800;
// After Claude emits its final `result` event the turn is logically done. We
// still wait for the CLI process to exit (post-turn usage probe / Stop hooks)
// before emitting TurnCompleted, but that wait must be bounded: if MCP child
// processes or hooks keep the CLI alive, the UI would otherwise stay stuck on
// "generating…" indefinitely. This grace caps how long we wait after `result`.
const CLAUDE_POST_RESULT_GRACE: Duration = Duration::from_secs(5);
// Before `result` is seen, the stream-read wait is normally unbounded by design (a legitimate
// turn can run a long time with no risk indicator present). But the CLI observably defers this
// turn's own `result` event until every pending Agent/Task subagent (`run_in_background: true`)
// has settled, so a subagent that crashes or hangs without ever emitting a terminal
// `task_notification` leaves this wait genuinely unbounded with no recovery path. This constant
// caps ONLY that specific pre-result window, and only while a pending Agent/Task subagent
// (`task_started`, no matching terminal notification yet) has actually been observed; a normal
// turn with no background task involved is never subject to it.
#[cfg(not(test))]
const CLAUDE_BG_TASK_MAX_WAIT: Duration = Duration::from_secs(30 * 60);
#[cfg(test)]
const CLAUDE_BG_TASK_MAX_WAIT: Duration = Duration::from_secs(3);
// Draining the stderr reader must be bounded for the same reason as the stdout
// wait above: a descendant that escaped the CLI's process group (e.g. an MCP
// server or Stop hook that called setsid) keeps the inherited stderr write end
// open, so the reader task never sees EOF and `force_kill_process_group`
// (a process-group kill) cannot reach it. stderr is only diagnostic, so cap the
// drain and abort the reader rather than wedge the turn on "generating…"
// forever — TurnCompleted must still fire. Mirrors the startup-timeout path's
// stderr handling.
const CLAUDE_POST_RESULT_STDERR_DRAIN: Duration = Duration::from_secs(2);
const CLAUDE_REASONING_EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];
const ASK_USER_QUESTION_TIMEOUT_SECS: u64 = 1800;
/// CLI MCP fetch timeout must exceed the server wait, or the race is zero-width.
const ASK_USER_QUESTION_CLI_TIMEOUT_MARGIN_SECS: u64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClaudeCommandProfile {
    Standard,
    ContextBootstrap,
}

impl ClaudeCommandProfile {
    fn is_context_bootstrap(self) -> bool {
        self == Self::ContextBootstrap
    }
}

#[derive(Debug, Default)]
struct BufferedClaudeTextDelta {
    text: String,
    started_at: Option<Instant>,
    first_stdout_received_at_ms: Option<u64>,
    stream_startup_timing: Option<ClaudeStreamStartupTiming>,
}

impl BufferedClaudeTextDelta {
    #[cfg(test)]
    fn push(&mut self, delta: &str) {
        self.push_with_timing(delta, None);
    }

    fn push_with_timing(&mut self, delta: &str, stdout_received_at_ms: Option<u64>) {
        if delta.is_empty() {
            return;
        }
        if self.started_at.is_none() {
            self.started_at = Some(Instant::now());
        }
        if self.first_stdout_received_at_ms.is_none() {
            self.first_stdout_received_at_ms = stdout_received_at_ms;
        }
        self.text.push_str(delta);
    }

    fn set_stream_startup_timing(&mut self, timing: &ClaudeStreamStartupTiming) {
        if self.stream_startup_timing.is_none() {
            self.stream_startup_timing = Some(timing.clone());
        }
    }

    fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    fn has_expired(&self, window: Duration) -> bool {
        self.started_at
            .map(|started_at| started_at.elapsed() >= window)
            .unwrap_or(false)
    }

    fn remaining_window(&self, window: Duration) -> Option<Duration> {
        let started_at = self.started_at?;
        window.checked_sub(started_at.elapsed())
    }

    #[cfg(test)]
    fn take(&mut self) -> Option<String> {
        self.take_with_timing().map(|emission| emission.text)
    }

    fn take_with_timing(&mut self) -> Option<BufferedClaudeTextDeltaEmission> {
        if self.text.is_empty() {
            self.started_at = None;
            self.first_stdout_received_at_ms = None;
            return None;
        }
        self.started_at = None;
        Some(BufferedClaudeTextDeltaEmission {
            text: std::mem::take(&mut self.text),
            stdout_received_at_ms: self.first_stdout_received_at_ms.take(),
            stream_startup_timing: self.stream_startup_timing.take(),
        })
    }
}

#[derive(Debug)]
struct BufferedClaudeTextDeltaEmission {
    text: String,
    stdout_received_at_ms: Option<u64>,
    stream_startup_timing: Option<ClaudeStreamStartupTiming>,
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

impl ClaudeSession {

    /// Send a message and stream the response
    pub async fn send_message(
        &self,
        params: SendMessageParams,
        turn_id: &str,
    ) -> Result<String, String> {
        self.send_message_with_app_settings(params, turn_id, None)
            .await
    }

    /// Variant of `send_message` that takes a snapshot of `AppSettings` so
    /// curated-skill transport can read the latest `enabled_curated_skill_ids`.
    /// Production callers use this; the wrapper `send_message` exists for
    /// legacy callers.
    pub async fn send_message_with_app_settings(
        &self,
        params: SendMessageParams,
        turn_id: &str,
        app_settings: Option<&crate::types::AppSettings>,
    ) -> Result<String, String> {
        self.send_message_with_app_settings_and_provider_env(params, turn_id, app_settings, None)
            .await
    }

    pub async fn send_message_with_app_settings_and_provider_env(
        &self,
        params: SendMessageParams,
        turn_id: &str,
        app_settings: Option<&crate::types::AppSettings>,
        provider_env: Option<&BTreeMap<String, String>>,
    ) -> Result<String, String> {
        self.send_message_with_profile(
            params,
            turn_id,
            app_settings,
            provider_env,
            ClaudeCommandProfile::Standard,
        )
        .await
    }

    pub async fn send_context_bootstrap_with_provider_env(
        &self,
        params: SendMessageParams,
        turn_id: &str,
        provider_env: Option<&BTreeMap<String, String>>,
    ) -> Result<String, String> {
        self.send_message_with_profile(
            params,
            turn_id,
            None,
            provider_env,
            ClaudeCommandProfile::ContextBootstrap,
        )
        .await
    }

    async fn send_message_with_profile(
        &self,
        params: SendMessageParams,
        turn_id: &str,
        app_settings: Option<&crate::types::AppSettings>,
        provider_env: Option<&BTreeMap<String, String>>,
        profile: ClaudeCommandProfile,
    ) -> Result<String, String> {
        self.remember_provider_env_for_turn(turn_id, provider_env);
        // Mark this as the active turn so a mid-turn MCP AskUserQuestion can find
        // the live event subscriber. Cleared on any exit path via the guard.
        self.set_active_turn(Some(turn_id));
        let _active_turn_guard = ActiveTurnGuard { session: self };

        let include_hook_events = !profile.is_context_bootstrap();
        match self
            .send_message_attempt(
                params.clone(),
                turn_id,
                include_hook_events,
                app_settings,
                provider_env,
                profile,
            )
            .await
        {
            Err(error)
                if include_hook_events && Self::is_unknown_include_hook_events_error(&error) =>
            {
                log::warn!(
                    "[claude] --include-hook-events unsupported, retrying without hook events: {}",
                    error
                );
                self.send_message_attempt(
                    params,
                    turn_id,
                    false,
                    app_settings,
                    provider_env,
                    profile,
                )
                .await
            }
            result => result,
        }
    }
}

#[cfg(test)]
#[path = "claude/tests_command.rs"]
mod tests_command;
#[cfg(test)]
#[path = "claude/tests_context_usage.rs"]
mod tests_context_usage;
#[cfg(test)]
#[path = "claude/tests_core.rs"]
mod tests_core;
#[cfg(test)]
#[path = "claude/tests_mode_blocked.rs"]
mod tests_mode_blocked;
#[cfg(test)]
#[path = "claude/tests_path_approval.rs"]
mod tests_path_approval;
