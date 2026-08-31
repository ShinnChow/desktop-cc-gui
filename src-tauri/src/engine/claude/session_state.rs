use super::*;
use super::tool_tracking::PendingClaudeTool;

pub(crate) type ClaudeAskUserQuestionResumeDiagnosticSink =
    Arc<dyn Fn(ClaudeAskUserQuestionResumeDiagnostic) + Send + Sync>;

#[derive(Debug, Clone)]
pub(crate) struct ClaudeAskUserQuestionResumeDiagnostic {
    pub(crate) workspace_id: String,
    pub(crate) thread_id: Option<String>,
    pub(crate) turn_id: String,
    pub(crate) request_id: Option<String>,
    pub(crate) succeeded: bool,
    pub(crate) error: Option<String>,
}

impl Drop for ClaudeSession {
    fn drop(&mut self) {
        let Ok(mut active) = self.active_processes.try_lock() else {
            log::warn!(
                "[claude] dropping session workspace={} while active_processes is locked; child cleanup fallback skipped",
                self.workspace_id
            );
            return;
        };
        if active.is_empty() {
            return;
        }
        for (turn_id, mut child) in active.drain() {
            let pid = child.id();
            match child.start_kill() {
                Ok(()) => {
                    log::info!(
                        "[claude] drop fallback started child kill workspace={} turn={} pid={:?}",
                        self.workspace_id,
                        turn_id,
                        pid
                    );
                }
                Err(error) => {
                    log::warn!(
                        "[claude] drop fallback failed to kill child workspace={} turn={} pid={:?}: {}",
                        self.workspace_id,
                        turn_id,
                        pid,
                        error
                    );
                }
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct ClaudeTurnEvent {
    pub turn_id: String,
    pub event: EngineEvent,
    pub stream_timing: Option<ClaudeStreamTiming>,
}

#[derive(Debug, Clone)]
pub(crate) struct ClaudeStreamTiming {
    pub(crate) stdout_received_at_ms: Option<u64>,
    pub(crate) process_spawn_started_at_ms: Option<u64>,
    pub(crate) process_spawned_at_ms: Option<u64>,
    pub(crate) stdin_write_started_at_ms: Option<u64>,
    pub(crate) stdin_closed_at_ms: Option<u64>,
    pub(crate) turn_started_at_ms: Option<u64>,
    pub(crate) first_stdout_line_at_ms: Option<u64>,
    pub(crate) first_valid_stream_event_at_ms: Option<u64>,
    pub(crate) first_text_delta_at_ms: Option<u64>,
    pub(crate) session_emitted_at_ms: u64,
}

/// Claude Code session for a workspace
pub struct ClaudeSession {
    /// Workspace identifier
    pub workspace_id: String,
    /// Opaque in-process locator used by the AskUserQuestion MCP bridge.
    pub(super) runtime_locator: String,
    /// Workspace directory path
    pub workspace_path: PathBuf,
    /// Current Claude session ID (for --resume)
    pub(super) session_id: RwLock<Option<String>>,
    /// Event broadcaster
    pub(super) event_sender: broadcast::Sender<ClaudeTurnEvent>,
    /// Custom binary path
    pub(super) bin_path: Option<String>,
    /// Custom home directory
    pub(super) home_dir: Option<String>,
    /// Additional CLI arguments
    pub(super) custom_args: Option<String>,
    /// Active child processes by turn ID (supports concurrent turns)
    pub(super) active_processes: Mutex<HashMap<String, Child>>,
    /// Flag set by interrupt() so send_message() knows the process was killed intentionally
    pub(super) interrupted: AtomicBool,
    /// Disposal flag set when workspace/session is being torn down.
    pub(super) disposed: AtomicBool,
    /// Track tool names for completion events
    pub(super) tool_name_by_id: StdMutex<HashMap<String, String>>,
    /// Track tool input buffers for streaming input_json_delta
    pub(super) tool_input_by_id: StdMutex<HashMap<String, String>>,
    /// Cache the latest structured tool input so completion events can reuse it
    pub(super) tool_input_value_by_id: StdMutex<HashMap<String, Value>>,
    /// Map turn-scoped content block index to tool id
    pub(super) tool_id_by_block_index: StdMutex<HashMap<(String, i64), String>>,
    /// Track unresolved tools so transcript-style tool_result payloads can be paired back
    pub(super) pending_tools: StdMutex<Vec<PendingClaudeTool>>,
    /// Last emitted text for assistant partial messages, isolated per turn
    pub(super) last_emitted_text_by_turn: StdMutex<HashMap<String, String>>,
    /// Last runtime model sidecar emitted for this turn (avoid per-token Raw).
    pub(super) emitted_runtime_model_by_turn: StdMutex<HashMap<String, String>>,
    /// Pending AskUserQuestion requests: request_id -> turn_id
    pub(super) pending_user_inputs: StdMutex<HashMap<String, String>>,
    /// Request ids that already completed settlement (accepted/skip/timeout).
    /// Used to suppress native tool_use re-conversion and resume re-entry.
    pub(super) settled_user_input_request_ids: StdMutex<HashSet<String>>,
    /// Pending synthetic Claude approval requests: request_id -> turn_id
    pub(super) pending_approval_requests: StdMutex<HashMap<String, String>>,
    /// Session L1 allowlist roots beyond workspace (startup --add-dir + grants).
    pub(super) session_allowed_roots: StdMutex<Vec<PathBuf>>,
    /// DirectoryGrant pending metadata: request_id -> suggested root path.
    pub(super) pending_directory_grants: StdMutex<HashMap<String, PathBuf>>,
    /// Synthetic approval summaries accumulated per turn for final completion reporting
    pub(super) synthetic_approval_summaries_by_turn:
        StdMutex<HashMap<String, Vec<SyntheticApprovalSummaryEntry>>>,
    /// Per-turn signal to resume stdout processing after approval responses arrive
    pub(super) approval_notify_by_turn: StdMutex<HashMap<String, Arc<Notify>>>,
    /// Per-turn formatted approval resolution text for kill+resume mechanism
    pub(super) approval_resume_message_by_turn: StdMutex<HashMap<String, String>>,
    /// Per-turn signal to resume stdout processing after AskUserQuestion response
    pub(super) user_input_notify_by_turn: StdMutex<HashMap<String, Arc<Notify>>>,
    /// Per-turn formatted AskUserQuestion answer for kill+resume mechanism
    pub(super) user_input_answer_by_turn: StdMutex<HashMap<String, String>>,
    /// Per-turn request id for AskUserQuestion resume diagnostics.
    pub(super) user_input_request_id_by_turn: StdMutex<HashMap<String, String>>,
    /// Per-turn frontend thread id for runtime diagnostics.
    pub(super) thread_id_by_turn: StdMutex<HashMap<String, String>>,
    /// AskUserQuestion resume attempts waiting for the resumed stream to produce a valid event.
    pub(super) pending_user_input_resume_diagnostic_by_turn: StdMutex<HashMap<String, Option<String>>>,
    /// Optional observer for real AskUserQuestion resume success/failure.
    pub(super) ask_user_question_resume_diagnostic_sink:
        StdMutex<Option<ClaudeAskUserQuestionResumeDiagnosticSink>>,
    /// Waiters for AskUserQuestion requests answered via the in-process MCP tool
    /// (B2 path): request_id -> oneshot sender carrying the formatted answer text.
    /// Present here means the answer is delivered by returning the MCP tool_result,
    /// so the kill/`--resume` path is skipped for that request.
    pub(super) mcp_answer_waiters: StdMutex<HashMap<String, tokio::sync::oneshot::Sender<String>>>,
    /// The turn currently being processed, if any. Set for the duration of
    /// `send_message_with_app_settings`. The in-process MCP server reads this to
    /// route a mid-turn AskUserQuestion to the live turn's event subscriber.
    pub(super) active_turn_id: StdMutex<Option<String>>,
    /// Provider environment captured for the lifetime of a turn, including
    /// approval/AskUserQuestion resume subprocesses.
    pub(super) provider_env_by_turn: StdMutex<HashMap<String, BTreeMap<String, String>>>,
}

/// Clears the session's active turn on drop, covering every exit path of
/// `send_message_with_app_settings` (including `?`/panic unwinds).
pub(super) struct ActiveTurnGuard<'a> {
    pub(super) session: &'a ClaudeSession,
}

impl Drop for ActiveTurnGuard<'_> {
    fn drop(&mut self) {
        self.session.set_active_turn(None);
    }
}


impl ClaudeSession {
    /// Create a new Claude session for tests.
    #[cfg(test)]
    pub fn new(
        workspace_id: String,
        workspace_path: PathBuf,
        config: Option<EngineConfig>,
    ) -> Self {
        Self::new_with_runtime(workspace_id, workspace_path, config)
    }

    pub fn new_with_runtime(
        workspace_id: String,
        workspace_path: PathBuf,
        config: Option<EngineConfig>,
    ) -> Self {
        let (event_sender, _) = broadcast::channel(1024);
        let config = config.unwrap_or_default();

        Self {
            workspace_id,
            runtime_locator: uuid::Uuid::new_v4().simple().to_string(),
            workspace_path,
            session_id: RwLock::new(None),
            event_sender,
            bin_path: config.bin_path,
            home_dir: config.home_dir,
            custom_args: config.custom_args,
            active_processes: Mutex::new(HashMap::new()),
            interrupted: AtomicBool::new(false),
            disposed: AtomicBool::new(false),
            tool_name_by_id: StdMutex::new(HashMap::new()),
            tool_input_by_id: StdMutex::new(HashMap::new()),
            tool_input_value_by_id: StdMutex::new(HashMap::new()),
            tool_id_by_block_index: StdMutex::new(HashMap::new()),
            pending_tools: StdMutex::new(Vec::new()),
            last_emitted_text_by_turn: StdMutex::new(HashMap::new()),
            emitted_runtime_model_by_turn: StdMutex::new(HashMap::new()),
            pending_user_inputs: StdMutex::new(HashMap::new()),
            settled_user_input_request_ids: StdMutex::new(HashSet::new()),
            pending_approval_requests: StdMutex::new(HashMap::new()),
            session_allowed_roots: StdMutex::new(Vec::new()),
            pending_directory_grants: StdMutex::new(HashMap::new()),
            synthetic_approval_summaries_by_turn: StdMutex::new(HashMap::new()),
            approval_notify_by_turn: StdMutex::new(HashMap::new()),
            approval_resume_message_by_turn: StdMutex::new(HashMap::new()),
            user_input_notify_by_turn: StdMutex::new(HashMap::new()),
            user_input_answer_by_turn: StdMutex::new(HashMap::new()),
            user_input_request_id_by_turn: StdMutex::new(HashMap::new()),
            thread_id_by_turn: StdMutex::new(HashMap::new()),
            pending_user_input_resume_diagnostic_by_turn: StdMutex::new(HashMap::new()),
            ask_user_question_resume_diagnostic_sink: StdMutex::new(None),
            mcp_answer_waiters: StdMutex::new(HashMap::new()),
            active_turn_id: StdMutex::new(None),
            provider_env_by_turn: StdMutex::new(HashMap::new()),
        }
    }

    pub(crate) fn runtime_locator(&self) -> &str {
        &self.runtime_locator
    }

    pub(crate) async fn has_active_turn(&self, turn_id: &str) -> bool {
        self.active_processes.lock().await.contains_key(turn_id)
    }

    pub(crate) fn register_turn_thread_id(&self, turn_id: &str, thread_id: &str) {
        let normalized_thread_id = thread_id.trim();
        if normalized_thread_id.is_empty() {
            return;
        }
        if let Ok(mut map) = self.thread_id_by_turn.lock() {
            map.insert(turn_id.to_string(), normalized_thread_id.to_string());
        }
    }

    pub(crate) fn set_ask_user_question_resume_diagnostic_sink(
        &self,
        sink: Option<ClaudeAskUserQuestionResumeDiagnosticSink>,
    ) {
        if let Ok(mut current) = self.ask_user_question_resume_diagnostic_sink.lock() {
            *current = sink;
        }
    }

    pub(super) fn take_user_input_request_id_for_turn(&self, turn_id: &str) -> Option<String> {
        self.user_input_request_id_by_turn
            .lock()
            .ok()
            .and_then(|mut map| map.remove(turn_id))
    }

    pub(super) fn remember_pending_ask_user_question_resume_diagnostic(
        &self,
        turn_id: &str,
        request_id: Option<String>,
    ) {
        if let Ok(mut map) = self.pending_user_input_resume_diagnostic_by_turn.lock() {
            map.insert(turn_id.to_string(), request_id);
        }
    }

    pub(super) fn take_pending_ask_user_question_resume_diagnostic(
        &self,
        turn_id: &str,
    ) -> Option<Option<String>> {
        self.pending_user_input_resume_diagnostic_by_turn
            .lock()
            .ok()
            .and_then(|mut map| map.remove(turn_id))
    }

    pub(super) fn emit_pending_ask_user_question_resume_success(&self, turn_id: &str) {
        if let Some(request_id) = self.take_pending_ask_user_question_resume_diagnostic(turn_id) {
            self.emit_ask_user_question_resume_diagnostic(turn_id, request_id, true, None);
        }
    }

    pub(super) fn emit_pending_ask_user_question_resume_failure(&self, turn_id: &str, error: &str) {
        if let Some(request_id) = self.take_pending_ask_user_question_resume_diagnostic(turn_id) {
            self.emit_ask_user_question_resume_diagnostic(
                turn_id,
                request_id,
                false,
                Some(error.to_string()),
            );
        }
    }

    pub(super) fn emit_ask_user_question_resume_diagnostic(
        &self,
        turn_id: &str,
        request_id: Option<String>,
        succeeded: bool,
        error: Option<String>,
    ) {
        let sink = self
            .ask_user_question_resume_diagnostic_sink
            .lock()
            .ok()
            .and_then(|current| current.clone());
        let thread_id = self
            .thread_id_by_turn
            .lock()
            .ok()
            .and_then(|map| map.get(turn_id).cloned());
        if let Some(sink) = sink {
            sink(ClaudeAskUserQuestionResumeDiagnostic {
                workspace_id: self.workspace_id.clone(),
                thread_id,
                turn_id: turn_id.to_string(),
                request_id,
                succeeded,
                error,
            });
        }
    }

    /// Get a receiver for engine events
    pub fn subscribe(&self) -> broadcast::Receiver<ClaudeTurnEvent> {
        self.event_sender.subscribe()
    }

    /// Get current session ID
    pub async fn get_session_id(&self) -> Option<String> {
        self.session_id.read().await.clone()
    }

    pub async fn active_process_ids(&self) -> Vec<u32> {
        let active = self.active_processes.lock().await;
        active.values().filter_map(|child| child.id()).collect()
    }

    pub(super) fn is_disposed(&self) -> bool {
        self.disposed.load(Ordering::SeqCst)
    }

    pub(crate) fn mark_disposed(&self) {
        self.disposed.store(true, Ordering::SeqCst);
    }

    /// Emit a TurnError event to notify the frontend when an error occurs
    /// outside the normal send_message flow (e.g., spawn failure, early errors).
    pub(super) fn emit_turn_event(&self, turn_id: &str, event: EngineEvent) {
        self.emit_turn_event_with_stream_timing(turn_id, event, None);
    }

    pub(super) fn emit_turn_event_with_stream_timing(
        &self,
        turn_id: &str,
        event: EngineEvent,
        stream_timing: Option<ClaudeStreamTiming>,
    ) {
        let _ = self.event_sender.send(ClaudeTurnEvent {
            turn_id: turn_id.to_string(),
            event,
            stream_timing,
        });
    }

    pub fn emit_error(&self, turn_id: &str, error: String) {
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnError {
                workspace_id: self.workspace_id.clone(),
                error,
                code: None,
            },
        );
    }

    /// Set session ID (after successful execution)
    pub async fn set_session_id(&self, id: Option<String>) {
        *self.session_id.write().await = id;
    }

    pub(super) fn set_active_turn(&self, turn_id: Option<&str>) {
        if let Ok(mut active) = self.active_turn_id.lock() {
            *active = turn_id.map(ToOwned::to_owned);
        }
    }

    pub(super) fn remember_provider_env_for_turn(
        &self,
        turn_id: &str,
        provider_env: Option<&BTreeMap<String, String>>,
    ) {
        if let Ok(mut environments) = self.provider_env_by_turn.lock() {
            match provider_env {
                Some(environment) => {
                    environments.insert(turn_id.to_string(), environment.clone());
                }
                None => {
                    environments.remove(turn_id);
                }
            }
        }
    }

    pub(super) fn provider_env_for_turn(&self, turn_id: &str) -> Option<BTreeMap<String, String>> {
        self.provider_env_by_turn
            .lock()
            .ok()
            .and_then(|environments| environments.get(turn_id).cloned())
    }

    /// The turn currently being processed, if any. Used by the in-process MCP
    /// AskUserQuestion server to route a mid-turn ask to the live subscriber.
    pub fn active_turn_id(&self) -> Option<String> {
        self.active_turn_id
            .lock()
            .ok()
            .and_then(|active| active.clone())
    }
}
