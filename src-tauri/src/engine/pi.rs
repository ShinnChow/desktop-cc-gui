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

const THINKING_LEVELS: &[&str] = &["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/// RPC resident path: a turn is settled by typed `agent_settled`, not process
/// EOF. 不按墙钟杀 turn（长 agentic 任务合法地跑几十分钟）：看门狗周期性
/// 与 resident 实况对账，只有持续静默才判超时。
const PI_RPC_TURN_WATCHDOG_TICK: Duration = Duration::from_secs(30);
/// 真超时判据：resident 完全静默（无任何 stdout 行）超过该预算才判死。
/// 必须覆盖 PI_RPC_COMPACT_TIMEOUT(500s)——auto-compaction 在 turn 收尾
/// 阶段同样可能长时间无流式事件。
const PI_RPC_TURN_SILENCE_TIMEOUT: Duration = Duration::from_secs(900);
/// After `abort`, give pi this long to settle before killing the resident.
const PI_RPC_ABORT_SETTLE_GRACE: Duration = Duration::from_secs(2);
/// `rpc_disabled` 闩的冷却期：置位后该窗口内拦新 spawn；窗口过后放行一次
/// 试探 spawn（成功清闩自愈，失败重新计时）。60s 覆盖 pi 二进制升级/资源
/// 瞬态耗尽；持续故障下每窗口最多白试一次（~2s handshake），不退化成每次
/// 发送都白 spawn。
const PI_RPC_DISABLED_RETRY_COOLDOWN: Duration = Duration::from_secs(60);

// ponytail: pi's NDJSON stream has no terminal "result" event, so turn end is
// detected by stdout EOF. A lingering grandchild (e.g. a bash tool daemon)
// that inherited the stdout pipe would keep the write end open and block EOF
// forever — the claude.rs "turn stuck generating" root cause. Poll child exit
// and stop reading after a grace. Ceiling: the orphan itself is not killed
// (pi, like kimi/grok, spawns without setpgid, so there is no process group to
// killpg); upgrade path = pre_exec setpgid + group kill if this ever bites.
const PI_STDOUT_EXIT_POLL: Duration = Duration::from_millis(250);
const PI_POST_EXIT_GRACE: Duration = Duration::from_secs(5);
const PI_STDERR_JOIN_TIMEOUT: Duration = Duration::from_secs(5);

/// 禁用闩是否拦截本次新 spawn：未置位不拦；冷却期内拦；冷却过后放行一
/// 次试探（纯函数，便于单测冷却矩阵）。
fn rpc_disabled_blocks_spawn(disabled_since: Option<Instant>, now: Instant) -> bool {
    match disabled_since {
        None => false,
        Some(since) => now.duration_since(since) < PI_RPC_DISABLED_RETRY_COOLDOWN,
    }
}

pub fn resolve_pi_session_id_for_engine_send(
    continue_session: bool,
    explicit_session_id: Option<String>,
    tracked_session_id: Option<String>,
) -> Option<String> {
    continue_session
        .then(|| explicit_session_id.or(tracked_session_id))
        .flatten()
}

/// Result of scanning prompt text for `@<path>` file reference tokens.
///
/// Pi CLI parses argv tokens starting with `@` as file arguments
/// (`cli/args.js`), and print mode never expands inline `@path` inside the
/// prompt message (that expansion is TUI-editor-only). mossx passes the whole
/// prompt as ONE positional argv element, so a prompt merely *starting* with
/// `@` makes pi treat the entire message — spaces, second `@`, Chinese text
/// and all — as a single fake file path and exit(1) with "File not found".
/// Extraction therefore (a) upgrades resolvable references to real `@file`
/// argv entries so their content is injected, and (b) strips them from the
/// prompt so the remaining text cannot be misparsed.
struct AtReferenceExtraction {
    text: String,
    file_args: Vec<String>,
}

/// Resolve a `@` reference candidate to an existing regular file.
///
/// Folders, missing paths, and non-path text (e.g. `@teammate`) return None
/// so callers keep the token verbatim in the prompt — pi is a tool-using
/// agent and can explore a directory path given as plain text, while
/// `@file` on a directory would make pi's file-processor exit(1).
fn resolve_at_reference_path(raw: &str, workspace_path: &Path) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with("data:") {
        return None;
    }
    let path = PathBuf::from(trimmed);
    let absolute = if path.is_absolute() {
        path
    } else {
        workspace_path.join(path)
    };
    match std::fs::metadata(&absolute) {
        Ok(meta) if meta.is_file() => Some(absolute),
        _ => None,
    }
}

/// Scan `text` for `@<path>` tokens at token boundaries (start of text or
/// after whitespace) and extract the ones resolving to existing regular
/// files into pi `@file` argv entries.
///
/// Matching is greedy longest-prefix against the filesystem: candidate
/// substrings end at each following whitespace boundary (and end of text),
/// longest first, so paths containing spaces (`@/abs/shot one.png`) resolve
/// as one token. Unresolvable tokens are preserved verbatim and scanning
/// continues after their `@`.
fn extract_at_file_references(text: &str, workspace_path: &Path) -> AtReferenceExtraction {
    let mut cleaned = String::with_capacity(text.len());
    let mut file_args: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let mut i = 0usize;
    while i < text.len() {
        let ch = text[i..].chars().next().expect("i is a char boundary");
        let at_token_boundary = ch == '@'
            && (i == 0
                || text[..i]
                    .chars()
                    .last()
                    .map(|prev| prev.is_whitespace())
                    .unwrap_or(false));
        if at_token_boundary {
            // Candidate ends: byte index of each whitespace after the `@`,
            // plus end of text. Try longest first.
            let mut ends: Vec<usize> = Vec::new();
            for (off, c) in text[i + 1..].char_indices() {
                if c.is_whitespace() {
                    ends.push(i + 1 + off);
                }
            }
            ends.push(text.len());
            let mut matched: Option<usize> = None;
            for &end in ends.iter().rev() {
                let candidate = &text[i + 1..end];
                if let Some(path) = resolve_at_reference_path(candidate, workspace_path) {
                    let key = path.to_string_lossy().to_string();
                    if seen.insert(key.clone()) {
                        file_args.push(format!("@{key}"));
                    }
                    matched = Some(end);
                    break;
                }
            }
            if let Some(end) = matched {
                // Drop the token; avoid doubling the boundary whitespace.
                i = end;
                if text[i..]
                    .chars()
                    .next()
                    .map(|next| next.is_whitespace())
                    .unwrap_or(false)
                    && cleaned
                        .chars()
                        .last()
                        .map(|prev| prev.is_whitespace())
                        .unwrap_or(false)
                {
                    i += text[i..]
                        .chars()
                        .next()
                        .expect("i is a char boundary")
                        .len_utf8();
                }
                continue;
            }
        }
        cleaned.push(ch);
        i += ch.len_utf8();
    }

    AtReferenceExtraction {
        text: cleaned,
        file_args,
    }
}

#[derive(Debug, Clone)]
pub struct PiTurnEvent {
    pub turn_id: String,
    /// 产生本事件的 run 的 main turn id（归属戳）。同一 resident 的广播
    /// 会被多个 send 的 forwarder 同时收到；转发器据此判定「这是不是我自己
    /// run 的 turn」，防止别的 send 的唤醒/派生 turn 串台到本 send 的线程
    /// （2026-08-30 实证：两个 send 交错时，A 的唤醒 turn 泄漏进 B 的
    /// forwarder，前端单 activeTurnId 结算守卫错配 → 响应中永久卡死）。
    pub run_owner: String,
    pub event: EngineEvent,
}

pub struct PiSession {
    pub workspace_id: String,
    pub workspace_path: PathBuf,
    session_id: RwLock<Option<String>>,
    event_sender: broadcast::Sender<PiTurnEvent>,
    bin_path: Option<String>,
    home_dir: Option<String>,
    custom_args: Option<String>,
    active_processes: Mutex<HashMap<String, ActivePiChildProcess>>,
    interrupted_turns: Mutex<HashSet<String>>,
    /// One RPC resident per PI session (and one scratch slot per new-send).
    /// Parallel native PI threads MUST NOT share a process — a single
    /// workspace-wide client serializes all tabs behind `switch_session`.
    residents: Arc<RwLock<HashMap<String, PiResident>>>,
    /// Sticky latch: handshake proved this binary cannot speak RPC.
    /// Per-session spawn failures do not set this; only `PiRpcClient::spawn`
    /// handshake errors do (old pi without `--mode rpc`). 记录置位时间：闩只
    /// 拦新 spawn（存活 resident 复用优先），冷却期过后放行一次试探
    /// spawn，成功即清闩自愈——禁止 app 生命周期内不可逆（用户实证：一次
    /// 切模型失败把全 workspace 的 RPC + 会话树打残到重启）。
    rpc_disabled_since: Arc<Mutex<Option<Instant>>>,
}

/// One `pi --mode rpc` process + the run currently streaming on it.
#[derive(Clone)]
struct PiResident {
    client: Arc<PiRpcClient>,
    run: Arc<RwLock<Option<PiRpcRun>>>,
    /// Serializes send-start vs fork/compact on this session (TOCTOU).
    op_lock: Arc<Mutex<()>>,
    /// True while prompt() is in flight and the run is not registered yet.
    in_flight: Arc<AtomicBool>,
    in_flight_turn: Arc<Mutex<Option<String>>>,
}

/// Map key: established sessions share a process; each new send without a
/// session id gets its own scratch process so it cannot steal another tab.
fn pi_resident_map_key(session_id: Option<&str>, scratch: &str) -> String {
    session_id
        .map(str::trim)
        .filter(|value| is_valid_pi_session_id_arg(value))
        .map(|value| format!("session:{value}"))
        .unwrap_or_else(|| format!("scratch:{scratch}"))
}

/// State of one streaming RPC agent run. PI can emit several native turns
/// inside one agent run (实测 0.84.4：每个工具往返都是一个新原生 turn ——
/// `turn_start`/`turn_end` 边界在 assistant 消息之间出现）；`active_turn_id`
/// tracks the native boundary while pending user turn ids wait for the next
/// `turn_start`.
struct PiRpcRun {
    main_turn_id: String,
    active_turn_id: String,
    seen_turn_start: bool,
    pending_turn_ids: VecDeque<String>,
    completed_turn_ids: HashSet<String>,
    /// 本 run 内已派生的 follow-up turn 数（非 orphan run 专用）。
    native_turn_seq: usize,
    requested_model: Option<String>,
    attached_turn_ids: Vec<String>,
    waiters: Vec<(String, oneshot::Sender<Result<String, String>>)>,
    response_text: String,
    authoritative_text: Option<String>,
    saw_tool_activity: bool,
    tool_names_by_id: HashMap<String, String>,
    tool_inputs_by_id: HashMap<String, Option<Value>>,
    stream_error: Option<String>,
    abort_requested: bool,
    /// True while the main turn is synthetic：run 承接的是 pi 自唤醒 turn
    /// （bg 任务完成通知注入等，不经过 ccgui 发送路径）。真实用户 turn
    /// 只排队到下一个原生 `turn_start`，不会收养外部正文。
    orphan: bool,
}

impl PiRpcRun {
    fn new(
        main_turn_id: &str,
        waiter: oneshot::Sender<Result<String, String>>,
        requested_model: Option<String>,
    ) -> Self {
        Self {
            main_turn_id: main_turn_id.to_string(),
            active_turn_id: main_turn_id.to_string(),
            seen_turn_start: false,
            pending_turn_ids: VecDeque::new(),
            completed_turn_ids: HashSet::new(),
            native_turn_seq: 0,
            requested_model,
            attached_turn_ids: Vec::new(),
            waiters: vec![(main_turn_id.to_string(), waiter)],
            response_text: String::new(),
            authoritative_text: None,
            saw_tool_activity: false,
            tool_names_by_id: HashMap::new(),
            tool_inputs_by_id: HashMap::new(),
            stream_error: None,
            abort_requested: false,
            orphan: false,
        }
    }

    /// pi 自唤醒 turn 的承接 run：main turn id 合成、waiter 无接收方
    /// （settle 时 send 失败静默跳过）。事件发往合成 id，被 daemon
    /// forwarder 按 turn_id 过滤天然丢弃，不污染任何真实会话 UI。
    fn new_orphan() -> Self {
        let (tx, _rx) = oneshot::channel();
        let mut run = Self::new(&next_pi_external_turn_id(), tx, None);
        run.orphan = true;
        run
    }
}

fn next_pi_external_turn_id() -> String {
    static EXTERNAL_TURN_SEQ: AtomicU64 = AtomicU64::new(0);
    let seq = EXTERNAL_TURN_SEQ.fetch_add(1, Ordering::SeqCst);
    format!(
        "pi-external-{}-{seq}",
        unix_timestamp_ms_for_process_diagnostics()
    )
}

/// pi 后台任务终态通知事件（扩展 `<background-task-notification>` 唤醒）。
pub(crate) fn is_pi_background_notification_event(event: &EngineEvent) -> bool {
    matches!(
        event,
        EngineEvent::BackgroundTaskUpdated { source, .. } if source == "notification"
    )
}

/// daemon/app forwarder 的外部 turn 门控：`pi-external-*` 仅在携带后台
/// 通知、仍有待回收后台任务、或属已知唤醒 turn 时放行进入当前会话。
pub(crate) fn is_pi_external_wakeup_allowed(
    external_turn_id: &str,
    primary_turn_id: &str,
    event: &EngineEvent,
    has_pending_background_tasks: bool,
    pending_external_wakeup: bool,
    is_known_external_wakeup: bool,
) -> bool {
    external_turn_id.starts_with("pi-external-")
        && (is_pi_background_notification_event(event)
            || has_pending_background_tasks
            || pending_external_wakeup
            || is_known_external_wakeup)
        && external_turn_id != primary_turn_id
}

/// pump 在 `agent_settled` 时发出的生命周期标记（run 彻底 settle）。
pub(crate) fn is_pi_agent_settled_marker(event: &EngineEvent) -> bool {
    matches!(
        event,
        EngineEvent::Raw { data, .. }
            if data.get("kind").and_then(Value::as_str) == Some("agent_settled")
    )
}

/// forwarder 归属判定（与 `PiTurnEvent.run_owner` 归属戳配套）：一个 send 的
/// forwarder 只转发——
/// 1. 自己 send id 的 turn（primary 本体，或 steer 绑定到别的 run 里的自身
///    turn——waiter 在本 send 手里，回复归属本 send 的线程）；
/// 2. 自己 run 的派生 turn（`{send}:t{n}`，普通多轮工具对话每回合一个）。
/// **别的 send 的 run（含其唤醒/派生 turn）一律拒绝**——同一 resident 的
/// 广播所有 forwarder 都收得到，放行会让 A 的 turn 串台进 B 的线程，前端
/// 单 activeTurnId 结算守卫错配后永久丢结算（2026-08-30 响应中卡死实证）。
/// 外部唤醒 turn（`pi-external-*`）与生命周期标记由各自门控单独放行。
pub(crate) fn is_pi_forwardable_send_turn(
    run_owner: &str,
    turn_id: &str,
    send_turn_id: &str,
) -> bool {
    if turn_id == send_turn_id {
        return true;
    }
    run_owner == send_turn_id && turn_id.starts_with(&format!("{send_turn_id}:"))
}

/// Bind the next native turn inside an active run.
///
/// 用户 steer 的真实 turn id 优先（pending 队列）。没有排队 turn 时：
/// - orphan run（pi 自唤醒）→ 合成 `pi-external-*` id，由 daemon 的外部
///   turn 门控决定是否投影；
/// - 用户自己的 run → 派生 `{main}:t{n}` id。这是**前台**流的一部分
///   （普通多轮工具对话里每个 assistant 回合都是一个新原生 turn，实测
///   0.84.4），daemon 必须无条件放行，不得套用外部门控。
fn bind_next_native_turn_id(run: &mut PiRpcRun) -> String {
    if let Some(turn_id) = run.pending_turn_ids.pop_front() {
        if run.orphan {
            // 外部唤醒期间 attach 的真实用户 turn 接管后续 run；否则下一
            // 个原生 turn 仍会被错误生成成 pi-external-*，用户回复会丢失。
            run.orphan = false;
            run.main_turn_id = turn_id.clone();
            run.active_turn_id = turn_id.clone();
        }
        return turn_id;
    }
    if run.orphan {
        return next_pi_external_turn_id();
    }
    run.native_turn_seq += 1;
    format!("{}:t{}", run.main_turn_id, run.native_turn_seq)
}

/// 单 resident 的发送决策：本地有活跃 run 必 steer；本地无 run 但 pi 仍在
/// streaming（pi 自唤醒 turn）也必须 steer——裸 prompt 会被 pi 以
/// "already processing" 拒绝（用户可见「会话失败」）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RpcSendMode {
    Prompt,
    Steer,
}

fn plan_rpc_send_mode(run_active: bool, streaming: bool) -> RpcSendMode {
    if run_active || streaming {
        RpcSendMode::Steer
    } else {
        RpcSendMode::Prompt
    }
}

/// pi 在 processing 时拒绝 prompt 的文案：
/// "Agent is already processing. Specify streamingBehavior ('steer' or
/// 'followUp') to queue the message."
/// 这是唯一值得转 steer 重试的 prompt 错误（判定与到达之间的竞态，且被拒
/// 消息在 preflight 阶段失败、未入队，重投无重复）；auth/模型等其余错误
/// 必须原样上报，不得重试。
fn is_rpc_busy_error(error: &str) -> bool {
    error.contains("already processing")
}

/// RPC send outcome: `Fallback` means "use the print-json path instead".
/// `Failed` = terminal error NOT yet emitted（send_message 统一发一次）；
/// `Settled` = 错误已随 run 结算发过一次（turn timeout 时全 waiter 一起
/// 结算），send_message 直接返回、禁止二次发 TurnError。
enum PiRpcSendError {
    Fallback(String),
    Failed(String),
    Settled(String),
}

#[allow(dead_code)]
pub struct PiActiveProcessSnapshot {
    pub pid: u32,
    pub registered_age_ms: u64,
}

struct ActivePiChildProcess {
    child: Child,
    /// 该 print-json 进程绑定的 PI session id（None = 新会话，spawn 出全新
    /// session JSONL）。fallback 忙互斥按它过滤：只有同一 session 的并发
    /// print-json 才会交叉写同一 JSONL；新会话 / 不同 session MUST 并行。
    session_id: Option<String>,
    #[allow(dead_code)]
    started_at_ms: u64,
}

impl ActivePiChildProcess {
    fn new(child: Child, session_id: Option<String>) -> Self {
        Self {
            child,
            session_id,
            started_at_ms: unix_timestamp_ms_for_process_diagnostics(),
        }
    }

    fn into_child(self) -> Child {
        self.child
    }

    #[allow(dead_code)]
    fn snapshot(&self, sampled_at_ms: u64) -> Option<PiActiveProcessSnapshot> {
        Some(PiActiveProcessSnapshot {
            pid: self.child.id()?,
            registered_age_ms: sampled_at_ms.saturating_sub(self.started_at_ms),
        })
    }
}

fn apply_interrupt_result(
    active_processes: &mut HashMap<String, ActivePiChildProcess>,
    interrupted_turns: &mut HashSet<String>,
    turn_id: &str,
    kill_result: Result<(), String>,
) -> Result<(), String> {
    kill_result?;
    interrupted_turns.insert(turn_id.to_string());
    active_processes.remove(turn_id);
    Ok(())
}

/// print-json fallback 的忙互斥判定：spawn-per-turn 进程只在「同一
/// session」并发时才会交叉写同一 session JSONL。新会话（None）各自落全新
/// JSONL，两个 None 进程互不冲突，恒放行；不同 session 写不同文件，放行。
fn print_json_fallback_busy<'a>(
    mut active_sessions: impl Iterator<Item = Option<&'a str>>,
    session_id: Option<&str>,
) -> bool {
    let Some(session_id) = session_id else {
        return false;
    };
    active_sessions.any(|active| active == Some(session_id))
}

fn unix_timestamp_ms_for_process_diagnostics() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn should_backfill_last_assistant_text(run: &PiRpcRun) -> bool {
    resolve_rpc_turn_text(run).trim().is_empty() && (run.orphan || !run.saw_tool_activity)
}

fn resolve_rpc_turn_text(run: &PiRpcRun) -> String {
    run.authoritative_text
        .as_deref()
        .filter(|text| !text.trim().is_empty())
        .unwrap_or(&run.response_text)
        .to_string()
}

fn commit_rpc_turn(workspace_id: &str, run: &mut PiRpcRun, emit: &dyn Fn(&str, EngineEvent)) {
    let turn_id = run.active_turn_id.clone();
    if !run.completed_turn_ids.insert(turn_id.clone()) {
        return;
    }
    let text = resolve_rpc_turn_text(run);
    run.response_text = text.clone();
    emit(
        &turn_id,
        EngineEvent::TurnCompleted {
            workspace_id: workspace_id.to_string(),
            result: Some(json!({ "text": text })),
        },
    );
    if let Some(index) = run
        .waiters
        .iter()
        .position(|(waiter_turn_id, _)| waiter_turn_id == &turn_id)
    {
        let (_, waiter) = run.waiters.remove(index);
        let _ = waiter.send(Ok(resolve_rpc_turn_text(run)));
    }
    run.authoritative_text = None;
    run.response_text.clear();
}

/// Settle an RPC run when PI closes without a per-turn boundary. Preserve the
/// main/active text and do not copy it into unrelated attached waiters.
fn settle_rpc_run(
    workspace_id: &str,
    run: PiRpcRun,
    fatal: Option<String>,
    emit: &dyn Fn(&str, EngineEvent),
) {
    let settled_text = resolve_rpc_turn_text(&run);
    let failure = fatal
        .or_else(|| {
            if run.abort_requested {
                Some("Session stopped.".to_string())
            } else if run.stream_error.is_some() {
                run.stream_error.clone()
            } else {
                None
            }
        })
        .or_else(|| {
            if settled_text.trim().is_empty() && !run.saw_tool_activity {
                Some("PI exited without assistant output.".to_string())
            } else {
                None
            }
        });
    if let Some(error) = failure.as_deref() {
        log_pi_failure_envelope(
            run.requested_model.as_deref(),
            "rpc",
            "foreground",
            error,
            None,
            !settled_text.trim().is_empty(),
            run.saw_tool_activity,
        );
    }
    // main waiter 仍按 id 判定；外部回合的 synthetic waiter 不得把正文
    // 错投给后续用户 turn。
    let main_turn_id = run.main_turn_id.clone();
    for (turn_id, waiter) in run.waiters.into_iter() {
        let is_main = turn_id == main_turn_id;
        match &failure {
            Some(error) => {
                emit(
                    &turn_id,
                    EngineEvent::TurnError {
                        workspace_id: workspace_id.to_string(),
                        error: error.clone(),
                        code: None,
                    },
                );
                let _ = waiter.send(Err(error.clone()));
            }
            None => {
                let text = if is_main || turn_id == run.active_turn_id {
                    settled_text.clone()
                } else {
                    String::new()
                };
                emit(
                    &turn_id,
                    EngineEvent::TurnCompleted {
                        workspace_id: workspace_id.to_string(),
                        result: Some(json!({ "text": text })),
                    },
                );
                let _ = waiter.send(Ok(text));
            }
        }
    }
}

fn pi_failure_category(error: &str) -> &'static str {
    let normalized = error.to_ascii_lowercase();
    if normalized.contains("fetch failed") || normalized.contains("network") {
        "upstream_transport"
    } else if normalized.contains("oauth")
        || normalized.contains("token")
        || normalized.contains("unauthorized")
        || normalized.contains("forbidden")
    {
        "authentication"
    } else if normalized.contains("model") {
        "model_selection"
    } else if normalized.contains("stopped") || normalized.contains("cancel") {
        "cancelled"
    } else if normalized.contains("exited") {
        "local_process_exit"
    } else {
        "runtime_error"
    }
}

fn bounded_pi_diagnostic(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(120).collect())
        .unwrap_or_else(|| "<unknown>".to_string())
}

fn log_pi_failure_envelope(
    model: Option<&str>,
    runtime_mode: &str,
    surface: &str,
    error: &str,
    task_id: Option<&str>,
    saw_assistant_output: bool,
    saw_tool_activity: bool,
) {
    log::warn!(
        "[pi/provider-failure] model={} runtime_mode={} surface={} category={} task_id={} saw_assistant_output={} saw_tool_activity={}",
        bounded_pi_diagnostic(model),
        runtime_mode,
        surface,
        pi_failure_category(error),
        bounded_pi_diagnostic(task_id),
        saw_assistant_output,
        saw_tool_activity,
    );
}

fn pi_background_task_failure(task: &Value) -> bool {
    matches!(
        task.get("status").and_then(Value::as_str),
        Some("failed" | "killed" | "cancelled")
    ) || task
        .get("exitCode")
        .and_then(Value::as_i64)
        .is_some_and(|code| code != 0)
}

fn log_pi_background_task_failure(
    model: Option<&str>,
    runtime_mode: &str,
    task: &Value,
    saw_assistant_output: bool,
    saw_tool_activity: bool,
) {
    if !pi_background_task_failure(task) {
        return;
    }
    log_pi_failure_envelope(
        model,
        runtime_mode,
        "background-task",
        "background task failed",
        task.get("id").and_then(Value::as_str),
        saw_assistant_output,
        saw_tool_activity,
    );
}

/// RPC transport carries images inline as base64 ImageContent blocks (the
/// print-json `@file` argv transport does not exist in RPC mode).
fn encode_images_for_rpc(
    images: Option<&[String]>,
    workspace_path: &Path,
) -> Result<Vec<Value>, String> {
    use base64::Engine as _;
    let files =
        crate::engine::cli_image_input::resolve_existing_image_files(images, workspace_path)?;
    let mut out = Vec::new();
    for file in files {
        let bytes = std::fs::read(&file)
            .map_err(|error| format!("failed to read image {}: {error}", file.display()))?;
        const MAX_RPC_IMAGE_BYTES: usize = 10 * 1024 * 1024;
        if bytes.len() > MAX_RPC_IMAGE_BYTES {
            return Err(format!(
                "image {} is too large for RPC inline ({} bytes, max {MAX_RPC_IMAGE_BYTES})",
                file.display(),
                bytes.len()
            ));
        }
        let ext = file
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let mime = match ext.as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            _ => "image/png",
        };
        out.push(json!({
            "type": "image",
            "data": base64::engine::general_purpose::STANDARD.encode(bytes),
            "mimeType": mime,
        }));
    }
    Ok(out)
}

struct RpcPromptExpansion {
    text: String,
    images: Vec<String>,
}

fn is_image_path(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp"
    )
}

fn expand_rpc_prompt_attachments(
    text: &str,
    images: Option<&[String]>,
    workspace_path: &Path,
) -> Result<RpcPromptExpansion, String> {
    let extraction = extract_at_file_references(text, workspace_path);
    let mut image_paths = crate::engine::cli_image_input::collect_non_empty_image_paths(images);
    let mut extras = String::new();
    const MAX_INJECT_CHARS: usize = 128 * 1024;
    for arg in extraction.file_args {
        let path = arg.trim_start_matches('@');
        if is_image_path(path) {
            if !image_paths.iter().any(|existing| existing == path) {
                image_paths.push(path.to_string());
            }
            continue;
        }
        match std::fs::read_to_string(path) {
            Ok(contents) => {
                let clipped = if contents.len() > MAX_INJECT_CHARS {
                    format!(
                        "{}\n…(truncated {} chars)",
                        &contents[..MAX_INJECT_CHARS],
                        contents.len() - MAX_INJECT_CHARS
                    )
                } else {
                    contents
                };
                extras.push_str(&format!("\n\n<file path=\"{path}\">\n{clipped}\n</file>"));
            }
            Err(error) => {
                log::warn!("[pi/rpc] @file {path} not readable: {error}");
            }
        }
    }
    let text = if extras.is_empty() {
        extraction.text
    } else {
        format!("{}{extras}", extraction.text)
    };
    Ok(RpcPromptExpansion {
        text,
        images: image_paths,
    })
}

enum PiStreamLine {
    SessionId(String),
    TurnStart,
    TurnEnd,
    TextDelta(String),
    ThinkingDelta(String),
    AssistantSnapshot(String),
    ToolStart {
        tool_id: String,
        tool_name: String,
        args: Option<Value>,
    },
    ToolEnd {
        tool_id: String,
        content: String,
        is_error: bool,
    },
    AssistantError(String),
    Usage(Value),
    /// `message_start` for `role:"custom"` + `customType:"background-task-notification"`
    /// (pi-background-tasks extension terminal wakeup). `message_end` carries an
    /// identical payload and is collapsed to `Other` for dedupe.
    BackgroundTaskNotification {
        details: Option<Value>,
        content: String,
    },
    Other,
}

fn resolve_model_flag(model: Option<&str>) -> Option<String> {
    let trimmed = model.map(str::trim).filter(|v| !v.is_empty())?;
    let lower = trimmed.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "__config_default__"
            | "auto"
            | "default"
            | "(default)"
            | "config-default"
            | "config_default"
            | "pi-default"
            | "pi default"
    ) {
        return None;
    }
    Some(trimmed.to_string())
}

/// Split a `provider/modelId` catalog id. Model ids may themselves contain
/// slashes (e.g. openrouter `openai/gpt-4o` → `openrouter/openai/gpt-4o`),
/// so only the FIRST segment is the provider.
fn split_provider_model(value: &str) -> Option<(String, String)> {
    let (provider, model_id) = value.split_once('/')?;
    let provider = provider.trim();
    let model_id = model_id.trim();
    if provider.is_empty() || model_id.is_empty() {
        return None;
    }
    Some((provider.to_string(), model_id.to_string()))
}

/// Reconcile plan for the resident's model vs the requested model.
#[derive(Debug, Clone, PartialEq, Eq)]
enum RpcModelReconcile {
    /// No explicit model requested (auto/default): resident keeps whatever
    /// the pi config default resolved to.
    Skip,
    /// Resident already runs the requested model.
    Match,
    /// Resident runs a different model: `set_model` before prompting.
    Set { provider: String, model_id: String },
    /// Bare model id (no provider prefix) that does not match the resident:
    /// `set_model` needs an explicit provider, so we cannot reconcile
    /// precisely — warn and keep the resident model.
    BareMismatch(String),
}

fn plan_rpc_model_reconcile(
    desired: Option<&str>,
    current: Option<(&str, &str)>,
) -> RpcModelReconcile {
    let Some(desired) = desired else {
        return RpcModelReconcile::Skip;
    };
    match split_provider_model(desired) {
        Some((provider, model_id)) => {
            if current == Some((provider.as_str(), model_id.as_str())) {
                RpcModelReconcile::Match
            } else {
                RpcModelReconcile::Set { provider, model_id }
            }
        }
        None => match current {
            Some((_, model_id)) if model_id == desired => RpcModelReconcile::Match,
            _ => RpcModelReconcile::BareMismatch(desired.to_string()),
        },
    }
}

// Session ids are passed as a CLI flag value; restrict to a conservative
// charset so a hostile or corrupted id (e.g. "-x") is never parsed as a flag.
fn is_valid_pi_session_id_arg(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn resolve_thinking_flag(effort: Option<&str>) -> Option<String> {
    pick_thinking_level(effort, None)
}

/// Prefer the model-specific allowlist from `get_available_thinking_levels`.
/// Fall back to the static CLI list when the resident has not reported one.
fn pick_thinking_level(effort: Option<&str>, available: Option<&[String]>) -> Option<String> {
    let normalized = effort?.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    if let Some(levels) = available.filter(|levels| !levels.is_empty()) {
        return levels
            .iter()
            .find(|level| level.eq_ignore_ascii_case(&normalized))
            .cloned();
    }
    THINKING_LEVELS
        .iter()
        .find(|level| **level == normalized)
        .map(|level| (*level).to_string())
}

/// pi-background-tasks extension tools that LAUNCH a durable background task
/// (the tool returns a receipt immediately; terminal state arrives later via a
/// `<background-task-notification>` followUp). Control tools (`bg_status` /
/// `bg_logs` / `bg_kill` / `bg_result`) are deliberately excluded: they keep
/// rendering as generic tool cards.
pub(crate) const PI_BACKGROUND_TASK_TOOLS: &[&str] = &[
    "bg_run",
    "bg_delegate",
    "bg_run_pi_attested",
    "fusion_reason",
    "fusion_investigate",
    "fusion_research",
    "fusion_validate",
];

/// `customType` the pi-background-tasks extension stamps on its terminal
/// followUp message (spike 2026-08-26: RPC `message_start`/`message_end` with
/// `message.role == "custom"`, structured snapshot under `message.details`).
pub(crate) const PI_BACKGROUND_TASK_NOTIFICATION_CUSTOM_TYPE: &str = "background-task-notification";

pub(crate) fn is_pi_background_task_tool(tool_name: &str) -> bool {
    PI_BACKGROUND_TASK_TOOLS.contains(&tool_name.trim())
}

/// Canonical task snapshot from a bg tool receipt. The extension attaches the
/// full snapshot at `result.details.task` (spike-verified); the text receipt is
/// parsed as a fallback for older extension versions. Returns None when neither
/// yields a task id — callers then degrade to a generic tool card.
pub(crate) fn parse_pi_background_task_receipt(result: Option<&Value>) -> Option<Value> {
    let result = result?;
    if let Some(task) = result
        .get("details")
        .and_then(|details| details.get("task"))
    {
        if task.get("id").and_then(Value::as_str).is_some() {
            return Some(task.clone());
        }
    }
    parse_pi_background_task_receipt_text(&extract_tool_result_text(Some(result)))
}

/// Text receipt fallback shape:
/// `Started background task <name> (<id>)\nStatus: running\nPID: 26137\nOutput: <path>`
fn parse_pi_background_task_receipt_text(text: &str) -> Option<Value> {
    let first_line = text.lines().next()?.trim();
    let rest = first_line.strip_prefix("Started background task ")?;
    let open = rest.rfind('(')?;
    let close = rest.rfind(')')?;
    if close <= open {
        return None;
    }
    let id = rest[open + 1..close].trim();
    if id.is_empty() {
        return None;
    }
    let name = rest[..open].trim();
    let mut task = json!({ "id": id, "status": "running" });
    if !name.is_empty() {
        task["name"] = json!(name);
    }
    for line in text.lines().skip(1) {
        let line = line.trim();
        if let Some(output) = line.strip_prefix("Output: ") {
            task["outputPath"] = json!(output.trim());
        } else if let Some(pid) = line.strip_prefix("PID: ") {
            if let Ok(pid) = pid.trim().parse::<u64>() {
                task["pid"] = json!(pid);
            }
        }
    }
    Some(task)
}

/// Canonical task snapshot from a `<background-task-notification>` wakeup:
/// prefer the structured `message.details` snapshot; fall back to the XML-ish
/// `content` envelope for older extension versions. None when no task id.
pub(crate) fn parse_pi_background_task_notification(
    details: Option<Value>,
    content: &str,
) -> Option<Value> {
    fn strip_xml_tags(value: &str) -> String {
        let mut output = String::with_capacity(value.len());
        let mut in_tag = false;
        for ch in value.chars() {
            match ch {
                '<' => in_tag = true,
                '>' if in_tag => in_tag = false,
                _ if !in_tag => output.push(ch),
                _ => {}
            }
        }
        output.split_whitespace().collect::<Vec<_>>().join(" ")
    }
    fn is_machine_completion_summary(value: &str) -> bool {
        let normalized = value.trim().to_ascii_lowercase();
        let machine_prefixes = [
            "background task ",
            "background shell task ",
            "background command ",
        ];
        let terminal_suffixes = [
            " completed",
            " failed",
            " killed",
            " cancelled",
            " canceled",
        ];
        machine_prefixes
            .iter()
            .any(|prefix| normalized.starts_with(prefix))
            && terminal_suffixes
                .iter()
                .any(|suffix| normalized.ends_with(suffix))
    }
    fn completion_text_from_details(details: &Value) -> Option<String> {
        ["summary", "result"]
            .iter()
            .filter_map(|key| details.get(*key))
            .find_map(|value| {
                value
                    .as_str()
                    .map(strip_xml_tags)
                    .filter(|text| !text.is_empty() && !is_machine_completion_summary(text))
            })
    }
    fn tag<'a>(text: &'a str, name: &str) -> Option<&'a str> {
        let open = format!("<{name}>");
        let close = format!("</{name}>");
        let start = text.find(&open)? + open.len();
        let end = text[start..].find(&close)? + start;
        let value = text[start..end].trim();
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    }
    let content_completion_text = ["summary", "result"]
        .iter()
        .filter_map(|name| tag(content, name))
        .find_map(|value| {
            let text = strip_xml_tags(value);
            (!text.is_empty() && !is_machine_completion_summary(&text)).then_some(text)
        });
    if let Some(details) = details {
        if details.get("id").and_then(Value::as_str).is_some() {
            let mut task = details;
            let existing_machine_summary = task
                .get("completionText")
                .and_then(Value::as_str)
                .map(is_machine_completion_summary)
                .unwrap_or(false);
            if task.get("completionText").is_none() || existing_machine_summary {
                if let Some(text) = content_completion_text
                    .clone()
                    .or_else(|| completion_text_from_details(&task))
                {
                    task["completionText"] = json!(text);
                } else if existing_machine_summary {
                    if let Some(object) = task.as_object_mut() {
                        object.remove("completionText");
                    }
                }
            }
            return Some(task);
        }
    }
    let id = tag(content, "task-id")?;
    let mut task = json!({ "id": id });
    if let Some(name) = tag(content, "task-name") {
        task["name"] = json!(name);
    }
    if let Some(status) = tag(content, "status") {
        task["status"] = json!(status);
    }
    if let Some(code) = tag(content, "exit-code").and_then(|v| v.parse::<i64>().ok()) {
        task["exitCode"] = json!(code);
    }
    if let Some(output) = tag(content, "output-file") {
        task["outputPath"] = json!(output);
    }
    if let Some(description) = content_completion_text {
        task["completionText"] = json!(description);
    }
    Some(task)
}

/// Surface the extension's custom notification message once per wakeup:
/// `message_start` wins, the identical `message_end` collapses to `Other`.
fn parse_pi_custom_message_line(event_type: &str, message: Option<&Value>) -> PiStreamLine {
    let Some(message) = message else {
        return PiStreamLine::Other;
    };
    let custom_type = message
        .get("customType")
        .and_then(Value::as_str)
        .unwrap_or("");
    if custom_type != PI_BACKGROUND_TASK_NOTIFICATION_CUSTOM_TYPE {
        return PiStreamLine::Other;
    }
    if event_type != "message_start" {
        return PiStreamLine::Other;
    }
    let details = message
        .get("details")
        .cloned()
        .filter(|value| value.is_object());
    let content = message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if details.is_none() && content.trim().is_empty() {
        return PiStreamLine::Other;
    }
    PiStreamLine::BackgroundTaskNotification { details, content }
}

fn extract_tool_result_text(result: Option<&Value>) -> String {
    let Some(result) = result else {
        return String::new();
    };
    if let Some(text) = result.as_str() {
        return text.to_string();
    }
    if let Some(content) = result.get("content") {
        if let Some(text) = content.as_str() {
            return text.to_string();
        }
        if let Some(parts) = content.as_array() {
            let text = parts
                .iter()
                .filter_map(|part| {
                    if let Some(text) = part.as_str() {
                        Some(text.to_string())
                    } else {
                        part.get("text").and_then(Value::as_str).map(str::to_string)
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            if !text.is_empty() {
                return text;
            }
        }
    }
    result.to_string()
}

fn extract_error_message(value: &Value) -> Option<String> {
    value
        .get("errorMessage")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .or_else(|| {
            value
                .get("message")
                .and_then(|message| message.get("errorMessage"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string)
        })
}

fn extract_assistant_text(message: &Value) -> Option<String> {
    if message.get("role").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let content = message.get("content")?;
    let text = match content {
        Value::String(value) => value.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| match part {
                Value::String(value) => Some(value.as_str()),
                Value::Object(object) => {
                    let kind = object.get("type").and_then(Value::as_str).unwrap_or("");
                    matches!(kind, "text" | "output_text")
                        .then(|| object.get("text").and_then(Value::as_str).unwrap_or(""))
                }
                _ => None,
            })
            .collect::<String>(),
        _ => String::new(),
    };
    (!text.trim().is_empty()).then_some(text)
}

/// Parse one NDJSON line from `pi --print --mode json`.
fn parse_pi_stream_line(value: &Value) -> PiStreamLine {
    let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
    match event_type {
        "session" => {
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string);
            match id {
                Some(session_id) => PiStreamLine::SessionId(session_id),
                None => PiStreamLine::Other,
            }
        }
        "message_update" => {
            let update = value.get("assistantMessageEvent");
            let update_type = update
                .and_then(|u| u.get("type"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let delta = update
                .and_then(|u| u.get("delta"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if delta.is_empty() {
                return PiStreamLine::Other;
            }
            match update_type {
                "text_delta" => PiStreamLine::TextDelta(delta.to_string()),
                "thinking_delta" => PiStreamLine::ThinkingDelta(delta.to_string()),
                _ => PiStreamLine::Other,
            }
        }
        "tool_execution_start" => {
            let tool_id = value
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let tool_name = value
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            let args = value.get("args").cloned();
            if tool_id.is_empty() {
                PiStreamLine::Other
            } else {
                PiStreamLine::ToolStart {
                    tool_id,
                    tool_name,
                    args,
                }
            }
        }
        "tool_execution_end" => {
            let tool_id = value
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if tool_id.is_empty() {
                return PiStreamLine::Other;
            }
            let content = extract_tool_result_text(value.get("result"));
            let is_error = value
                .get("isError")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            PiStreamLine::ToolEnd {
                tool_id,
                content,
                is_error,
            }
        }
        "message_end" | "message_start" => {
            if let Some(error) = extract_error_message(value) {
                return PiStreamLine::AssistantError(error);
            }
            let message = value.get("message");
            let role = message
                .and_then(|m| m.get("role"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if role == "custom" {
                return parse_pi_custom_message_line(event_type, message);
            }
            if role == "assistant" {
                if event_type == "message_end" {
                    if let Some(text) = message.and_then(extract_assistant_text) {
                        return PiStreamLine::AssistantSnapshot(text);
                    }
                }
                if let Some(usage) = message.and_then(|m| m.get("usage")) {
                    return PiStreamLine::Usage(usage.clone());
                }
            }
            PiStreamLine::Other
        }
        "turn_start" => PiStreamLine::TurnStart,
        "turn_end" => {
            if let Some(error) = extract_error_message(value) {
                PiStreamLine::AssistantError(error)
            } else {
                PiStreamLine::TurnEnd
            }
        }
        "agent_end" => extract_error_message(value)
            .map(PiStreamLine::AssistantError)
            .unwrap_or(PiStreamLine::Other),
        _ => PiStreamLine::Other,
    }
}

impl PiSession {
    pub fn new(
        workspace_id: String,
        workspace_path: PathBuf,
        config: Option<EngineConfig>,
    ) -> Self {
        let (event_sender, _) = broadcast::channel(8192);
        let config = config.unwrap_or_default();
        Self {
            workspace_id,
            workspace_path,
            session_id: RwLock::new(None),
            event_sender,
            bin_path: config.bin_path,
            home_dir: config.home_dir,
            custom_args: config.custom_args,
            active_processes: Mutex::new(HashMap::new()),
            interrupted_turns: Mutex::new(HashSet::new()),
            residents: Arc::new(RwLock::new(HashMap::new())),
            rpc_disabled_since: Arc::new(Mutex::new(None)),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<PiTurnEvent> {
        self.event_sender.subscribe()
    }

    pub async fn get_session_id(&self) -> Option<String> {
        self.session_id.read().await.clone()
    }

    async fn set_session_id(&self, id: Option<String>) {
        *self.session_id.write().await = id;
    }

    fn emit_turn_event(&self, turn_id: &str, event: EngineEvent) {
        let _ = self.event_sender.send(PiTurnEvent {
            turn_id: turn_id.to_string(),
            // 发送边事件（SessionStarted/TurnStarted/结算错误）归属本 send 的 turn。
            run_owner: turn_id.to_string(),
            event,
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

    fn resolve_bin_path(&self) -> String {
        if let Some(ref custom) = self.bin_path {
            custom.clone()
        } else {
            crate::backend::app_server::find_cli_binary("pi", None)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "pi".to_string())
        }
    }

    // ===== RPC resident path (`pi --mode rpc`) =====

    /// Ensure a live RPC resident for THIS session (or a dedicated scratch
    /// process for a brand-new send). Never reuse another session's process
    /// and never fall back to the workspace-level tracked session id.
    async fn ensure_resident(
        &self,
        session_id_hint: Option<&str>,
        model: Option<&str>,
        scratch: &str,
    ) -> Result<PiResident, String> {
        let key = pi_resident_map_key(session_id_hint, scratch);
        {
            let guard = self.residents.read().await;
            if let Some(resident) = guard.get(&key) {
                if resident.client.is_alive().await {
                    return Ok(resident.clone());
                }
            }
        }
        let mut guard = self.residents.write().await;
        if let Some(resident) = guard.get(&key) {
            if resident.client.is_alive().await {
                return Ok(resident.clone());
            }
            guard.remove(&key);
        }
        // 禁用闩只拦新 spawn：已存活的 resident（并行 tab）必须继续复用。
        // 否则一次历史会话 spawn 失败会把全 workspace 的 RPC 长驻进程全部
        // 打成 print-json（实测表现：只剩一个 PI 能跑）。冷却期过后放行一次
        // 试探 spawn：成功即清闩自愈，失败重新计时——闩不可逆会让新会话 /
        // 会话树静默残废到 app 重启（用户实证）。
        {
            let disabled_since = *self.rpc_disabled_since.lock().await;
            if rpc_disabled_blocks_spawn(disabled_since, Instant::now()) {
                return Err("pi rpc disabled after previous failure".to_string());
            }
            if disabled_since.is_some() {
                log::info!(
                    "[pi/rpc] rpc_disabled cooldown elapsed; probing spawn (workspace={})",
                    self.workspace_id
                );
            }
        }
        let bind_session_id = session_id_hint
            .map(str::trim)
            .filter(|value| is_valid_pi_session_id_arg(value));
        let spawn_result = PiRpcClient::spawn(
            &self.resolve_bin_path(),
            &self.workspace_path,
            bind_session_id,
            model,
            self.home_dir.as_deref(),
            self.custom_args.as_deref(),
        )
        .await;
        match spawn_result {
            Ok(client) => {
                // 试探/常规 spawn 成功：清闩自愈（未置位时 take 为 None，静默
                // 跳过，不分支）。
                if self.rpc_disabled_since.lock().await.take().is_some() {
                    log::info!(
                        "[pi/rpc] spawn succeeded; rpc_disabled latch cleared (workspace={})",
                        self.workspace_id
                    );
                }
                if let Some(id) = client.session_id().await {
                    self.set_session_id(Some(id)).await;
                }
                let run = Arc::new(RwLock::new(None));
                let resident = PiResident {
                    client: client.clone(),
                    run: run.clone(),
                    op_lock: Arc::new(Mutex::new(())),
                    in_flight: Arc::new(AtomicBool::new(false)),
                    in_flight_turn: Arc::new(Mutex::new(None)),
                };
                self.spawn_rpc_projection(client, run);
                guard.insert(key.clone(), resident.clone());
                log::info!(
                    "[pi/rpc] resident spawned workspace={} key={key} bind={:?}",
                    self.workspace_id,
                    bind_session_id
                );
                Ok(resident)
            }
            Err(error) => {
                *self.rpc_disabled_since.lock().await = Some(Instant::now());
                Err(error)
            }
        }
    }

    /// 预热：spawn + handshake（get_state + refresh_thinking_levels，均在
    /// PiRpcClient::spawn 内完成）返回即就绪。幂等——已存活 resident 早退；
    /// rpc_disabled 闩与 ensure_resident 同源拒绝。仅供 engine_prewarm 调用，
    /// 首次发送仍走 ensure_resident 主路径（双轨，不新增失败路径）。
    /// 只接受带 session id 的恢复会话：pending 会话的 send scratch 是每 turn
    /// 唯一的 turn id，预热 resident 无法被 send 命中，只会白起一个进程。
    pub async fn prewarm_resident(&self, session_id: &str) -> Result<(), String> {
        let session_id = session_id.trim();
        if !is_valid_pi_session_id_arg(session_id) {
            return Err("pi prewarm requires a valid session id".to_string());
        }
        self.ensure_resident(Some(session_id), None, "prewarm")
            .await
            .map(|_| ())
    }

    async fn rekey_resident(&self, from: &str, to: &str) {
        if from == to {
            return;
        }
        let mut guard = self.residents.write().await;
        let Some(resident) = guard.remove(from) else {
            return;
        };
        guard.insert(to.to_string(), resident);
    }

    /// Project raw RPC agent events onto EngineEvents routed to the active run.
    fn spawn_rpc_projection(
        &self,
        client: Arc<PiRpcClient>,
        rpc_run: Arc<RwLock<Option<PiRpcRun>>>,
    ) {
        let mut receiver = client.subscribe();
        let event_sender = self.event_sender.clone();
        let residents = self.residents.clone();
        let workspace_id = self.workspace_id.clone();
        tokio::spawn(async move {
            // 当前事件所属 run 的归属戳：pump 在每个事件处理时刷新（orphan
            // 建 run / turn_start 换绑不改变 main），emit 时随事件带出。
            let current_run_owner = std::sync::Mutex::new(String::new());
            let emit = |turn_id: &str, event: EngineEvent| {
                let run_owner = current_run_owner.lock().ok().map(|owner| owner.clone());
                let _ = event_sender.send(PiTurnEvent {
                    turn_id: turn_id.to_string(),
                    run_owner: run_owner.unwrap_or_default(),
                    event,
                });
            };
            loop {
                let pump_event = match receiver.recv().await {
                    Ok(event) => event,
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        log::warn!("[pi/rpc] projection lagged; skipped {skipped} events");
                        continue;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                };
                match pump_event {
                    PiRpcPumpEvent::Agent(value) => {
                        let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
                        if event_type == "agent_settled" {
                            let run = rpc_run.write().await.take();
                            // 生命周期标记：run 彻底 settle（无重试/无排队
                            // continuation）。daemon forwarder 以此判定
                            // 「本 run 真正结束」，避免在第一个原生 turn 的
                            // TurnCompleted 处过早断开、丢掉 run 内后续
                            // 原生 turn（实测 0.84.4 的多 turn 结构）。
                            let settled_marker_turn_id = run
                                .as_ref()
                                .map(|run| run.main_turn_id.clone())
                                .unwrap_or_else(|| format!("pi-settled-{workspace_id}"));
                            if let Some(mut run) = run {
                                // 自唤醒回合通常先收到 custom notification，因而会被
                                // 标记为 tool activity；该回合的 assistant 正文仍可能只
                                // 保存在 resident 的 last assistant message 中。
                                // 普通 tool-only 回合继续禁止回读，避免把上一轮正文带入本轮。
                                if should_backfill_last_assistant_text(&run) {
                                    if let Ok(text) = client.get_last_assistant_text().await {
                                        if !text.trim().is_empty() {
                                            run.response_text = text;
                                        }
                                    }
                                }
                                settle_rpc_run(&workspace_id, run, None, &emit);
                            }
                            emit(
                                &settled_marker_turn_id,
                                EngineEvent::Raw {
                                    workspace_id: workspace_id.clone(),
                                    engine: EngineType::Pi,
                                    data: json!({
                                        "source": "pi_rpc",
                                        "kind": "agent_settled",
                                    }),
                                },
                            );
                            continue;
                        }
                        if event_type == "compaction_start" || event_type == "compaction_end" {
                            let turn_id = {
                                let guard = rpc_run.read().await;
                                guard.as_ref().map(|run| run.main_turn_id.clone())
                            };
                            let turn_id =
                                turn_id.or_else(|| Some(format!("pi-compact-{}", workspace_id)));
                            if let Some(turn_id) = turn_id {
                                let kind = if event_type == "compaction_start" {
                                    "compaction_start"
                                } else {
                                    "compaction_end"
                                };
                                emit(
                                    &turn_id,
                                    EngineEvent::Raw {
                                        workspace_id: workspace_id.clone(),
                                        engine: EngineType::Pi,
                                        data: json!({
                                            "source": "pi_rpc",
                                            "kind": kind,
                                            "payload": value,
                                        }),
                                    },
                                );
                            }
                            continue;
                        }
                        let mut guard = rpc_run.write().await;
                        if guard.is_none() && event_type == "agent_start" {
                            // pi 自唤醒 turn（bg 任务完成通知注入等）不经过
                            // ccgui 发送路径：建 orphan run 承接事件流；真实
                            // 用户消息稍后只排队到下一个原生 turn。
                            *guard = Some(PiRpcRun::new_orphan());
                        }
                        let Some(run) = guard.as_mut() else {
                            continue;
                        };
                        *current_run_owner.lock().unwrap() = run.main_turn_id.clone();
                        let turn_id = run.active_turn_id.clone();
                        match parse_pi_stream_line(&value) {
                            PiStreamLine::TurnStart => {
                                let is_first_turn = !run.seen_turn_start;
                                run.seen_turn_start = true;
                                if is_first_turn {
                                    if run.orphan {
                                        emit(
                                            &run.active_turn_id,
                                            EngineEvent::TurnStarted {
                                                workspace_id: workspace_id.clone(),
                                                turn_id: run.active_turn_id.clone(),
                                            },
                                        );
                                    }
                                } else {
                                    run.active_turn_id = bind_next_native_turn_id(run);
                                    run.response_text.clear();
                                    run.authoritative_text = None;
                                    if !run.completed_turn_ids.contains(&run.active_turn_id) {
                                        emit(
                                            &run.active_turn_id,
                                            EngineEvent::TurnStarted {
                                                workspace_id: workspace_id.clone(),
                                                turn_id: run.active_turn_id.clone(),
                                            },
                                        );
                                    }
                                }
                            }
                            PiStreamLine::TurnEnd => {
                                commit_rpc_turn(&workspace_id, run, &emit);
                            }
                            PiStreamLine::TextDelta(delta) => {
                                run.response_text.push_str(&delta);
                                emit(
                                    &turn_id,
                                    EngineEvent::TextDelta {
                                        workspace_id: workspace_id.clone(),
                                        text: delta,
                                    },
                                );
                            }
                            PiStreamLine::AssistantSnapshot(text) => {
                                run.authoritative_text = Some(text);
                            }
                            PiStreamLine::ThinkingDelta(delta) => {
                                emit(
                                    &turn_id,
                                    EngineEvent::ReasoningDelta {
                                        workspace_id: workspace_id.clone(),
                                        text: delta,
                                    },
                                );
                            }
                            PiStreamLine::ToolStart {
                                tool_id,
                                tool_name,
                                args,
                            } => {
                                run.saw_tool_activity = true;
                                run.tool_names_by_id
                                    .insert(tool_id.clone(), tool_name.clone());
                                run.tool_inputs_by_id.insert(tool_id.clone(), args.clone());
                                if is_pi_background_task_tool(&tool_name) {
                                    emit(
                                        &turn_id,
                                        EngineEvent::BackgroundTaskStarted {
                                            workspace_id: workspace_id.clone(),
                                            tool_id,
                                            tool_name,
                                            input: args,
                                        },
                                    );
                                } else {
                                    emit(
                                        &turn_id,
                                        EngineEvent::ToolStarted {
                                            workspace_id: workspace_id.clone(),
                                            tool_id,
                                            tool_name,
                                            input: args,
                                        },
                                    );
                                }
                            }
                            PiStreamLine::ToolEnd {
                                tool_id,
                                content,
                                is_error,
                            } => {
                                run.saw_tool_activity = true;
                                let tool_name = run.tool_names_by_id.get(&tool_id).cloned();
                                let is_background_task_tool = tool_name
                                    .as_deref()
                                    .map(is_pi_background_task_tool)
                                    .unwrap_or(false);
                                let receipt_task = if is_background_task_tool && !is_error {
                                    parse_pi_background_task_receipt(value.get("result"))
                                } else {
                                    None
                                };
                                if let Some(task) = receipt_task {
                                    log_pi_background_task_failure(
                                        run.requested_model.as_deref(),
                                        "rpc",
                                        &task,
                                        !run.response_text.trim().is_empty(),
                                        run.saw_tool_activity,
                                    );
                                    // bg 工具 receipt 解析成功：工具卡升级为后台
                                    // 任务卡，不再发普通 ToolCompleted。
                                    emit(
                                        &turn_id,
                                        EngineEvent::BackgroundTaskUpdated {
                                            workspace_id: workspace_id.clone(),
                                            tool_id: Some(tool_id),
                                            task,
                                            source: "receipt".to_string(),
                                        },
                                    );
                                    continue;
                                }
                                let wrapped_output =
                                    match run.tool_inputs_by_id.get(&tool_id).cloned() {
                                        Some(Some(input_value)) => Some(json!({
                                            "_input": input_value,
                                            "_output": content,
                                        })),
                                        _ => Some(Value::String(content.clone())),
                                    };
                                emit(
                                    &turn_id,
                                    EngineEvent::ToolCompleted {
                                        workspace_id: workspace_id.clone(),
                                        tool_id,
                                        tool_name,
                                        output: wrapped_output,
                                        error: is_error.then_some(content),
                                    },
                                );
                            }
                            PiStreamLine::BackgroundTaskNotification { details, content } => {
                                // 通知不算 tool activity，但足以让 run 免于
                                //「无输出」误判（notify-only 唤醒 turn）。
                                run.saw_tool_activity = true;
                                if let Some(task) =
                                    parse_pi_background_task_notification(details, &content)
                                {
                                    log_pi_background_task_failure(
                                        run.requested_model.as_deref(),
                                        "rpc",
                                        &task,
                                        !run.response_text.trim().is_empty(),
                                        run.saw_tool_activity,
                                    );
                                    emit(
                                        &turn_id,
                                        EngineEvent::BackgroundTaskUpdated {
                                            workspace_id: workspace_id.clone(),
                                            tool_id: None,
                                            task,
                                            source: "notification".to_string(),
                                        },
                                    );
                                }
                            }
                            PiStreamLine::AssistantError(error) => {
                                run.stream_error = Some(error);
                            }
                            PiStreamLine::Usage(_)
                            | PiStreamLine::SessionId(_)
                            | PiStreamLine::Other => {}
                        }
                    }
                    PiRpcPumpEvent::Exited(code) => {
                        log::warn!(
                            "[pi/rpc] resident exited workspace={} code={:?}",
                            workspace_id,
                            code
                        );
                        let run = rpc_run.write().await.take();
                        if let Some(run) = run {
                            settle_rpc_run(
                                &workspace_id,
                                run,
                                Some("pi rpc process exited".to_string()),
                                &emit,
                            );
                        }
                        // Drop the dead handle so the next send respawns.
                        let mut map = residents.write().await;
                        map.retain(|_, resident| !Arc::ptr_eq(&resident.client, &client));
                        break;
                    }
                }
            }
        });
    }

    /// RPC main path: idle -> `prompt` (new run), streaming -> `steer`
    /// (attach to the active run; settles with it, empty text).
    async fn try_send_message_rpc(
        &self,
        params: &SendMessageParams,
        turn_id: &str,
    ) -> Result<String, PiRpcSendError> {
        let scratch_key = pi_resident_map_key(params.session_id.as_deref(), turn_id);
        let resident = self
            .ensure_resident(
                params.session_id.as_deref(),
                resolve_model_flag(params.model.as_deref()).as_deref(),
                turn_id,
            )
            .await
            .map_err(PiRpcSendError::Fallback)?;
        let client = resident.client.clone();
        self.settle_stale_rpc_run_if_idle(&resident).await;
        // streaming 即活跃：pi 自唤醒 turn（本地无 run）同样禁止
        // align/reconcile，否则可能 mid-turn 切会话 / set_model。
        if resident.run.read().await.is_some() || client.is_streaming() {
            // Same-session steer. Other PI tabs have their own resident and
            // MUST stay parallel — do not reject this send as "another session".
            if let Some(desired) = resolve_model_flag(params.model.as_deref()) {
                let current = client.current_model_identity().await;
                let current_ref = current.as_ref().map(|(p, m)| (p.as_str(), m.as_str()));
                if plan_rpc_model_reconcile(Some(desired.as_str()), current_ref)
                    != RpcModelReconcile::Match
                {
                    log::warn!(
                        "[pi/rpc] steer attach keeps active run model; requested {} differs (workspace={})",
                        desired,
                        self.workspace_id
                    );
                }
            }
        } else {
            if let Err(error) = self
                .align_rpc_session(&resident, params.session_id.as_deref())
                .await
            {
                return Err(PiRpcSendError::Failed(error));
            }
            self.reconcile_rpc_model(&client, params.model.as_deref())
                .await?;
        }
        let expanded = expand_rpc_prompt_attachments(
            &params.text,
            params.images.as_deref(),
            &self.workspace_path,
        )
        .map_err(PiRpcSendError::Failed)?;
        let images = encode_images_for_rpc(Some(expanded.images.as_slice()), &self.workspace_path)
            .map_err(PiRpcSendError::Failed)?;
        let available = client.available_thinking_levels().await;
        if let Some(thinking) = pick_thinking_level(params.effort.as_deref(), available.as_deref())
        {
            // Best effort: level support is model-dependent; failure must not
            // block the prompt itself.
            if let Err(error) = client.set_thinking_level(&thinking).await {
                log::warn!("[pi/rpc] set_thinking_level({thinking}) failed: {error}");
            }
        } else if let Some(requested) = params
            .effort
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            log::info!(
                "[pi/rpc] skip set_thinking_level({requested}); not in model allowlist {:?} (workspace={})",
                available,
                self.workspace_id
            );
        }

        let (tx, rx) = oneshot::channel();
        let send_mode = {
            let _op = resident.op_lock.lock().await;
            plan_rpc_send_mode(resident.run.read().await.is_some(), client.is_streaming())
        };
        if send_mode == RpcSendMode::Steer {
            // Queue the user turn before writing to PI. `steer` can return after
            // PI has already emitted `turn_start`; attaching afterwards races
            // that boundary and assigns the native turn a synthetic id.
            self.attach_turn_to_rpc_run(&resident, turn_id, tx).await;
            if let Err(error) = client.steer(&expanded.text, images).await {
                self.detach_turn_from_rpc_run(&resident, turn_id).await;
                return Err(PiRpcSendError::Failed(format!(
                    "pi rpc steer failed: {error}"
                )));
            }
        } else {
            resident.in_flight.store(true, Ordering::SeqCst);
            *resident.in_flight_turn.lock().await = Some(turn_id.to_string());
            // 先建 real run 再写 prompt：pi 接受 prompt 后立即开始推事件，
            // RPC response 与事件广播是两条并发通道（实测 0.84.4 两者同毫秒
            // 到达）。若等 prompt 返回才建 run，pump 会先收到 agent_start 并
            // 误建 orphan 承接本 run（turn_start 在 orphan 上消耗）——随后
            // 真实 run 覆盖槽位、seen_turn_start 丢失，第二个原生 turn 被当
            // 成 first turn 折叠回 primary id，而 primary 已被前端终态账本
            // 标记，后续内容全部丢弃（同会话第二次发送必现丢尾的根因）。
            // busy 竞态下若槽位已被 pump 抢建（pi 恰好自唤醒），沿用既有
            // attach 语义，不覆盖在跑的 run。
            // 槽位非空（pump 恰好为 pi 自唤醒抢建了 orphan）：走既有 attach
            // 语义，waiter 入队等下一个原生 turn_start 绑定；rx 已随 attach
            // 进入 run.waiters，prompt 后直接落入看门狗等待结算。
            let attached_to_existing_run = {
                let mut guard = resident.run.write().await;
                if guard.is_none() {
                    *guard = Some(PiRpcRun::new(turn_id, tx, params.model.clone()));
                    self.emit_turn_event(
                        turn_id,
                        EngineEvent::TurnStarted {
                            workspace_id: self.workspace_id.clone(),
                            turn_id: turn_id.to_string(),
                        },
                    );
                    false
                } else {
                    drop(guard);
                    self.attach_turn_to_rpc_run(&resident, turn_id, tx).await;
                    true
                }
            };
            if attached_to_existing_run {
                let prompt_result = client.prompt(&expanded.text, images.clone()).await;
                resident.in_flight.store(false, Ordering::SeqCst);
                *resident.in_flight_turn.lock().await = None;
                if let Err(error) = prompt_result {
                    return Err(PiRpcSendError::Failed(format!(
                        "pi rpc prompt failed: {error}"
                    )));
                }
                self.finish_prompt_send_resident_state(&client, &scratch_key, turn_id)
                    .await;
                // 落入下方看门狗等待结算。
            } else {
                let prompt_result = client.prompt(&expanded.text, images.clone()).await;
                resident.in_flight.store(false, Ordering::SeqCst);
                *resident.in_flight_turn.lock().await = None;
                let busy_steered = match prompt_result {
                    Ok(()) => false,
                    Err(error) if is_rpc_busy_error(&error) => {
                        // 判定与到达之间的竞态：pi 已开始处理（多为 bg 任务完成
                        // 自唤醒），prompt 在 preflight 被拒、消息未入队 → 转
                        // steer 重投一次，随当前 turn 结算。waiter 已是本 run 的
                        // main（预创建），随 run 原生结算，无需再 attach。
                        log::warn!(
                            "[pi/rpc] prompt rejected as busy; retrying as steer (workspace={})",
                            self.workspace_id
                        );
                        if let Err(error) = client.steer(&expanded.text, images).await {
                            return Err(PiRpcSendError::Failed(format!(
                                "pi rpc steer failed: {error}"
                            )));
                        }
                        true
                    }
                    Err(error) => {
                        // prompt 被拒、本 run 不会开始：摘下预创建的 run 并按失败
                        // 结算 waiter，避免发送边悬挂到看门狗超时。
                        let run = resident.run.write().await.take();
                        if let Some(run) = run {
                            settle_rpc_run(
                                &self.workspace_id,
                                run,
                                Some(format!("pi rpc prompt failed: {error}")),
                                &|turn_id, event| {
                                    let _ = self.event_sender.send(PiTurnEvent {
                                        turn_id: turn_id.to_string(),
                                        run_owner: turn_id.to_string(),
                                        event,
                                    });
                                },
                            );
                        }
                        return Err(PiRpcSendError::Failed(format!(
                            "pi rpc prompt failed: {error}"
                        )));
                    }
                };
                if !busy_steered {
                    self.finish_prompt_send_resident_state(&client, &scratch_key, turn_id)
                        .await;
                }
            }
        }

        // Turn 结算看门狗：不按墙钟杀 turn，每个 tick 与 resident 实况对账——
        //   streaming + 事件新鲜  → 长任务正常运行，继续等；
        //   !streaming + run 有产出 → agent_settled 丢失（broadcast lag /
        //     树切换 rebind 空窗），按完成结算，rx 随 settle 解决；
        //   resident 持续静默超预算 → 真超时，报错并 abort。
        let turn_started_at = Instant::now();
        let mut missing_run_ticks = 0u8;
        let mut rx = rx;
        loop {
            match tokio::time::timeout(PI_RPC_TURN_WATCHDOG_TICK, &mut rx).await {
                Ok(Ok(Ok(text))) => return Ok(text),
                Ok(Ok(Err(error))) => return Err(PiRpcSendError::Settled(error)),
                Ok(Err(_closed)) => {
                    return Err(PiRpcSendError::Failed(
                        "pi rpc run waiter dropped".to_string(),
                    ));
                }
                Err(_elapsed) => {}
            }

            let has_output = {
                let guard = resident.run.read().await;
                guard.as_ref().map(|run| {
                    !run.response_text.trim().is_empty()
                        || run.saw_tool_activity
                        || run.stream_error.is_some()
                })
            };
            let Some(has_output) = has_output else {
                // run 已被投影侧结算：rx 下一 tick 内应就绪。禁止再 emit
                // TurnError（投影已发过终态）。
                missing_run_ticks += 1;
                if missing_run_ticks >= 3 {
                    return Err(PiRpcSendError::Settled("pi rpc turn timed out".to_string()));
                }
                continue;
            };
            missing_run_ticks = 0;

            if !client.is_streaming() {
                if has_output {
                    log::warn!(
                        "[pi/rpc] turn={} settlement event missed; settling from resident ground truth",
                        turn_id
                    );
                    let run = resident.run.write().await.take();
                    if let Some(run) = run {
                        let workspace_id = self.workspace_id.clone();
                        let sender = self.event_sender.clone();
                        settle_rpc_run(&workspace_id, run, None, &|turn_id, event| {
                            let _ = sender.send(PiTurnEvent {
                                turn_id: turn_id.to_string(),
                                run_owner: turn_id.to_string(),
                                event,
                            });
                        });
                    }
                    continue;
                }
                // 无产出且未 streaming：prompt 可能尚未 agent_start，给足静默预算。
                if turn_started_at.elapsed() < PI_RPC_TURN_SILENCE_TIMEOUT {
                    continue;
                }
            } else if client
                .last_event_age()
                .is_some_and(|age| age < PI_RPC_TURN_SILENCE_TIMEOUT)
            {
                continue;
            }

            let error = "pi rpc turn timed out".to_string();
            let run = resident.run.write().await.take();
            if let Some(run) = run {
                let workspace_id = self.workspace_id.clone();
                let sender = self.event_sender.clone();
                settle_rpc_run(
                    &workspace_id,
                    run,
                    Some(error.clone()),
                    &|turn_id, event| {
                        let _ = sender.send(PiTurnEvent {
                            turn_id: turn_id.to_string(),
                            run_owner: turn_id.to_string(),
                            event,
                        });
                    },
                );
            } else {
                self.emit_error(turn_id, error.clone());
            }
            let _ = client.abort().await;
            return Err(PiRpcSendError::Settled(error));
        }
    }

    /// Public RPC accessors for Tauri commands. These never fall back: the
    /// caller needs RPC-only state (stats / tree / fork), so failure is
    /// surfaced as a command error. MUST key by the caller's session so a
    /// tree/stats open cannot steal or serialize another tab's resident.
    pub async fn rpc_client_for_commands(
        &self,
        session_id: Option<&str>,
    ) -> Result<Arc<PiRpcClient>, String> {
        let resident = self.ensure_resident(session_id, None, "commands").await?;
        self.align_rpc_session(&resident, session_id).await?;
        Ok(resident.client)
    }

    /// Run a mutating RPC command (fork/compact) while holding the session
    /// op_lock so a concurrent send cannot sneak past the busy check.
    pub async fn with_exclusive_rpc_command<T, F, Fut>(
        &self,
        session_id: Option<&str>,
        f: F,
    ) -> Result<T, String>
    where
        F: FnOnce(Arc<PiRpcClient>) -> Fut,
        Fut: std::future::Future<Output = Result<T, String>>,
    {
        let resident = self.ensure_resident(session_id, None, "commands").await?;
        let _op = resident.op_lock.lock().await;
        self.settle_stale_rpc_run_if_idle(&resident).await;
        self.align_rpc_session(&resident, session_id).await?;
        if resident.run.read().await.is_some() || resident.in_flight.load(Ordering::SeqCst) {
            return Err("当前 turn 仍在进行中，无法执行该操作；请等待完成或先停止。".to_string());
        }
        f(resident.client.clone()).await
    }

    pub async fn restore_tracked_session_id(&self, id: Option<String>) {
        self.set_session_id(id).await;
    }

    /// Whether THIS session's resident currently has a streaming run.
    /// Fork/compact on this session still refuse; other sessions stay parallel.
    pub async fn rpc_has_active_run_for(&self, session_id: Option<&str>) -> bool {
        let key = pi_resident_map_key(session_id, "commands");
        let resident = {
            let guard = self.residents.read().await;
            guard.get(&key).cloned()
        };
        match resident {
            Some(resident) => {
                resident.run.read().await.is_some()
                    || resident.in_flight.load(Ordering::SeqCst)
                    || resident.client.is_streaming()
            }
            None => false,
        }
    }

    /// OpenSpec change：fix-orphan-turn-during-backend-unavailability（F2）。
    /// Send gate 双证据之一（只读，不置位不清闩）：RPC spawn disabled latch
    /// 是否处于冷却期。与 fallback busy 叠加时 engine_send_message 快速失败，
    /// 不返回 started 让前端孤儿等待。
    pub async fn rpc_spawn_blocked(&self) -> bool {
        let disabled_since = *self.rpc_disabled_since.lock().await;
        rpc_disabled_blocks_spawn(disabled_since, Instant::now())
    }

    /// OpenSpec change：fix-orphan-turn-during-backend-unavailability（F2）。
    /// Send gate 双证据之二（只读）：print-json spawn-per-turn fallback 是否
    /// 被同 session 的活跃子进程占用。
    pub async fn print_json_fallback_blocked(&self, session_id: Option<&str>) -> bool {
        let active = self.active_processes.lock().await;
        print_json_fallback_busy(
            active.values().map(|process| process.session_id.as_deref()),
            session_id,
        )
    }

    /// steer 发送后的统一 attach：run 缺失（pi 自唤醒 turn 的 agent_start
    /// 尚未泵到）时补 orphan run；真实用户 turn 只进入 pending 队列，
    /// 在下一个原生 `turn_start` 到达时绑定，禁止把外部 turn 的正文收养
    /// 到用户消息。
    async fn attach_turn_to_rpc_run(
        &self,
        resident: &PiResident,
        turn_id: &str,
        tx: oneshot::Sender<Result<String, String>>,
    ) {
        {
            let mut guard = resident.run.write().await;
            if guard.is_none() {
                *guard = Some(PiRpcRun::new_orphan());
            }
            let run = guard.as_mut().expect("run just ensured");
            run.pending_turn_ids.push_back(turn_id.to_string());
            run.attached_turn_ids.push(turn_id.to_string());
            run.waiters.push((turn_id.to_string(), tx));
        }
    }

    async fn detach_turn_from_rpc_run(&self, resident: &PiResident, turn_id: &str) {
        let mut guard = resident.run.write().await;
        let Some(run) = guard.as_mut() else {
            return;
        };
        run.pending_turn_ids.retain(|pending| pending != turn_id);
        run.attached_turn_ids.retain(|attached| attached != turn_id);
        run.waiters
            .retain(|(waiter_turn_id, _)| waiter_turn_id != turn_id);
    }

    /// prompt 被接受后的 resident 收尾：回填 session id、rekey、广播
    /// SessionStarted。TurnStarted 已在预创建 run 时发出，不再重复。
    async fn finish_prompt_send_resident_state(
        &self,
        client: &Arc<PiRpcClient>,
        scratch_key: &str,
        turn_id: &str,
    ) {
        let session_id = client
            .session_id()
            .await
            .unwrap_or_else(|| "pending".to_string());
        if is_valid_pi_session_id_arg(&session_id) {
            self.rekey_resident(scratch_key, &format!("session:{session_id}"))
                .await;
            self.set_session_id(Some(session_id.clone())).await;
        }
        self.emit_turn_event(
            turn_id,
            EngineEvent::SessionStarted {
                workspace_id: self.workspace_id.clone(),
                session_id,
                engine: EngineType::Pi,
                turn_id: Some(turn_id.to_string()),
            },
        );
    }

    /// Self-heal a single resident: run present but RPC not streaming means
    /// `agent_settled` was missed. Do not inspect other sessions' runs.
    async fn settle_stale_rpc_run_if_idle(&self, resident: &PiResident) {
        {
            let guard = resident.run.read().await;
            if guard.is_none() || resident.client.is_streaming() {
                return;
            }
        }
        let run = resident.run.write().await.take();
        if let Some(run) = run {
            log::warn!(
                "[pi/rpc] settling stale run turn={} (settlement event missed)",
                run.main_turn_id
            );
            let workspace_id = self.workspace_id.clone();
            let sender = self.event_sender.clone();
            settle_rpc_run(
                &workspace_id,
                run,
                Some("PI turn lost its settlement event; settled defensively.".to_string()),
                &|turn_id, event| {
                    let _ = sender.send(PiTurnEvent {
                        turn_id: turn_id.to_string(),
                        run_owner: turn_id.to_string(),
                        event,
                    });
                },
            );
        }
    }

    /// Bind THIS resident to the caller's session file. Other tabs keep their
    /// own processes; a live run on this process still refuses a file switch.
    async fn align_rpc_session(
        &self,
        resident: &PiResident,
        target_session_id: Option<&str>,
    ) -> Result<(), String> {
        self.settle_stale_rpc_run_if_idle(resident).await;
        let client = &resident.client;
        let target = target_session_id
            .map(str::trim)
            .filter(|value| is_valid_pi_session_id_arg(value));
        let current = client.session_id().await;
        match target {
            Some(target) if current.as_deref() == Some(target) => Ok(()),
            Some(target) => {
                // streaming 即活跃：pi 自唤醒 turn（本地无 run）期间同样
                // 禁止切会话文件。
                if resident.run.read().await.is_some() || client.is_streaming() {
                    return Err(
                        "当前 turn 仍在进行中，无法切换会话文件；请等待完成或先停止。".to_string(),
                    );
                }
                let file = match crate::engine::pi_history::resolve_pi_session_file_by_id(
                    self.home_dir.as_deref(),
                    target,
                    &self.workspace_path,
                )
                .await?
                {
                    Some(file) => file,
                    None => {
                        log::warn!(
                            "[pi/rpc] session file not found for {}, starting fresh session (workspace={})",
                            target,
                            self.workspace_id
                        );
                        client.new_session().await?;
                        if let Some(id) = client.session_id().await {
                            self.set_session_id(Some(id)).await;
                        }
                        return Ok(());
                    }
                };
                client.switch_session(&file.to_string_lossy()).await?;
                self.set_session_id(Some(target.to_string())).await;
                log::info!(
                    "[pi/rpc] aligned resident to session {} workspace={}",
                    target,
                    self.workspace_id
                );
                Ok(())
            }
            // New send already has a dedicated scratch process; do not call
            // new_session again (that discarded the handshake session).
            None => Ok(()),
        }
    }

    pub async fn drop_resident(&self, session_id: &str) {
        self.drop_resident_by_key(&format!("session:{session_id}"))
            .await;
    }

    /// 按 resident map key 释放。send fallback 路径用它覆盖 scratch 槽
    /// （`pi_resident_map_key(None / 非法 id, turn_id)`），避免只认
    /// `session:{id}` 导致新会话 resident 泄漏。
    async fn drop_resident_by_key(&self, key: &str) {
        let resident = {
            let mut guard = self.residents.write().await;
            guard.remove(key)
        };
        let Some(resident) = resident else {
            return;
        };
        if resident.run.read().await.is_some() {
            let _ = resident.client.abort().await;
        }
        resident.client.kill().await;
        log::info!(
            "[pi/rpc] dropped resident key={key} workspace={}",
            self.workspace_id
        );
    }

    /// Reconcile the resident's model with the requested model before a new
    /// run starts. `set_model` failure degrades to the print-json fallback
    /// (which honors `--model` per send) instead of failing the turn.
    async fn reconcile_rpc_model(
        &self,
        client: &Arc<PiRpcClient>,
        requested_model: Option<&str>,
    ) -> Result<(), PiRpcSendError> {
        let desired = resolve_model_flag(requested_model);
        let current = client.current_model_identity().await;
        let current_ref = current.as_ref().map(|(p, m)| (p.as_str(), m.as_str()));
        match plan_rpc_model_reconcile(desired.as_deref(), current_ref) {
            RpcModelReconcile::Skip | RpcModelReconcile::Match => Ok(()),
            RpcModelReconcile::Set { provider, model_id } => {
                log::info!(
                    "[pi/rpc] reconciling resident model {:?} -> {provider}/{model_id} (workspace={})",
                    current,
                    self.workspace_id
                );
                client
                    .set_model(&provider, &model_id)
                    .await
                    .map(|_| ())
                    .map_err(|error| {
                        PiRpcSendError::Fallback(format!(
                            "pi rpc set_model({provider}/{model_id}) failed: {error}"
                        ))
                    })
            }
            RpcModelReconcile::BareMismatch(bare) => {
                log::warn!(
                    "[pi/rpc] bare model id {bare:?} cannot be reconciled (no provider prefix); resident stays on {:?} (workspace={})",
                    current,
                    self.workspace_id
                );
                Ok(())
            }
        }
    }

    /// After a fork the resident is bound to a NEW session file; refresh the
    /// tracked session id so the next send/resume follows it.
    pub async fn rpc_resync_session_id(&self, client: &Arc<PiRpcClient>) -> Option<String> {
        match client.get_state().await {
            Ok(state) => {
                let id = state
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                if let Some(ref id) = id {
                    self.set_session_id(Some(id.clone())).await;
                }
                id
            }
            Err(error) => {
                log::warn!("[pi/rpc] get_state after fork failed: {error}");
                None
            }
        }
    }

    fn build_command(&self, params: &SendMessageParams) -> Result<Command, String> {
        let bin = self.resolve_bin_path();

        let mut cmd = crate::backend::app_server::build_command_for_binary(&bin);
        cmd.current_dir(&self.workspace_path);
        // Custom args go first so the protocol flags below (--print/--mode/--session-id)
        // always win over user configuration in last-wins CLI parsing.
        if let Some(args) = self.custom_args.as_ref() {
            for arg in args.split_whitespace() {
                cmd.arg(arg);
            }
        }
        cmd.arg("--print");
        cmd.arg("--mode");
        cmd.arg("json");

        if let Some(model) = resolve_model_flag(params.model.as_deref()) {
            cmd.arg("--model");
            cmd.arg(model);
        }

        if params.continue_session {
            if let Some(session_id) = params
                .session_id
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .filter(|value| is_valid_pi_session_id_arg(value))
            {
                cmd.arg("--session-id");
                cmd.arg(session_id);
            }
        }

        if let Some(thinking) = resolve_thinking_flag(params.effort.as_deref()) {
            cmd.arg("--thinking");
            cmd.arg(thinking);
        }

        let image_files = crate::engine::cli_image_input::resolve_existing_image_files(
            params.images.as_deref(),
            &self.workspace_path,
        )?;
        // Pi print mode natively attaches `@file` arguments as image content
        // blocks (deterministic, processed by pi's file processor); keep the
        // prompt itself free of any injected marker or read-tool instruction.
        // `@<path>` reference tokens embedded in the prompt text get the same
        // transport: pi's argv parser treats ANY arg starting with `@` as a
        // file arg, and the whole prompt is one argv element, so a prompt
        // starting with `@` would otherwise turn the entire message into one
        // fake file path and exit(1) with "File not found".
        let mut at_args = crate::engine::cli_image_input::pi_image_file_args(&image_files);
        let extraction = extract_at_file_references(&params.text, &self.workspace_path);
        for reference_arg in extraction.file_args {
            if !at_args.contains(&reference_arg) {
                at_args.push(reference_arg);
            }
        }
        for at_arg in at_args {
            cmd.arg(at_arg);
        }
        let prompt_text = extraction.text;
        // Positional prompt; avoid a leading '-' being parsed as a flag and a
        // leading '@' (unresolvable reference token) being parsed as a file arg.
        let safe_text = if prompt_text.starts_with('-') || prompt_text.starts_with('@') {
            format!(" {prompt_text}")
        } else {
            prompt_text
        };
        cmd.arg(&safe_text);

        if let Some(home) = self.home_dir.as_ref() {
            cmd.env("PI_CODING_AGENT_DIR", home);
            // Sessions default under agent_dir/sessions; keep home aligned.
            cmd.env("HOME", home);
        }

        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        Ok(cmd)
    }

    pub async fn send_message(
        &self,
        params: SendMessageParams,
        turn_id: &str,
    ) -> Result<String, String> {
        match self.try_send_message_rpc(&params, turn_id).await {
            Ok(text) => return Ok(text),
            Err(PiRpcSendError::Fallback(reason)) => {
                log::warn!(
                    "[pi/send] turn={} rpc unavailable, falling back to print-json: {}",
                    turn_id,
                    reason
                );
                // 释放本次发送实际占用的 resident。key 必须与
                // try_send_message_rpc 的 scratch_key 同源：session_id=None /
                // 非法 id 时 resident 在 scratch:{turn_id} 槽，旧逻辑只 drop
                // session:{id} 会让新会话 resident 泄漏。
                let resident_key = pi_resident_map_key(params.session_id.as_deref(), turn_id);
                self.drop_resident_by_key(&resident_key).await;
            }
            Err(PiRpcSendError::Failed(error)) => {
                self.emit_error(turn_id, error.clone());
                return Err(error);
            }
            Err(PiRpcSendError::Settled(error)) => {
                // 终态已随 run 结算发出（turn timeout 路径），禁止重发。
                return Err(error);
            }
        }
        // print-json fallback 是 spawn-per-turn：同会话并发进程会交叉写同一
        // session JSONL。融合（fusion）在矩阵升 supported 后可能打到这条
        // 路径——此时必须拒绝而不是假装 steer，让消息留在队列里。
        // 互斥粒度是「同一 session」而不是全 workspace：不同 session / 新会话
        // 各自写不同 JSONL，必须允许并行。
        {
            let print_json_busy = {
                let active = self.active_processes.lock().await;
                print_json_fallback_busy(
                    active.values().map(|process| process.session_id.as_deref()),
                    params.session_id.as_deref(),
                )
            };
            // session_id=None 的新发送没有可对账的本会话 resident（scratch 槽
            // 刚在上方释放），无需查 rpc run；scratch:commands 是树/fork 面板
            // 共享槽，与本次发送无关。
            let rpc_busy = match params.session_id.as_deref() {
                Some(session_id) => self.rpc_has_active_run_for(Some(session_id)).await,
                None => false,
            };
            if print_json_busy || rpc_busy {
                let error = "PI session is busy (rpc unavailable, print-json fallback cannot steer); the message stays queued.".to_string();
                self.emit_error(turn_id, error.clone());
                return Err(error);
            }
        }
        self.send_message_print_json(params, turn_id).await
    }

    async fn send_message_print_json(
        &self,
        params: SendMessageParams,
        turn_id: &str,
    ) -> Result<String, String> {
        let turn_started_at = std::time::Instant::now();
        let requested_model = params
            .model
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("<auto>");
        log::info!(
            "[pi/send] turn={} workspace={} model={} continue_session={}",
            turn_id,
            self.workspace_id,
            requested_model,
            params.continue_session,
        );

        let mut command = match self.build_command(&params) {
            Ok(command) => command,
            Err(error) => {
                let error_msg = format!("Failed to build pi command: {error}");
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let error_msg = format!("Failed to spawn pi: {error}");
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };
        let spawn_ms = turn_started_at.elapsed().as_millis();

        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let error_msg = "Failed to capture stdout".to_string();
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };
        let stderr = match child.stderr.take() {
            Some(stderr) => stderr,
            None => {
                let error_msg = "Failed to capture stderr".to_string();
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };

        {
            let mut active = self.active_processes.lock().await;
            active.insert(
                turn_id.to_string(),
                ActivePiChildProcess::new(child, params.session_id.clone()),
            );
        }

        self.emit_turn_event(
            turn_id,
            EngineEvent::SessionStarted {
                workspace_id: self.workspace_id.clone(),
                session_id: "pending".to_string(),
                engine: EngineType::Pi,
                turn_id: Some(turn_id.to_string()),
            },
        );
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnStarted {
                workspace_id: self.workspace_id.clone(),
                turn_id: turn_id.to_string(),
            },
        );

        let stderr_reader = BufReader::new(stderr);
        let stderr_task = tokio::spawn(async move {
            let mut lines = stderr_reader.lines();
            let mut text = String::new();
            while let Ok(Some(line)) = lines.next_line().await {
                text.push_str(&line);
                text.push('\n');
            }
            text
        });

        let mut response_text = String::new();
        let mut authoritative_response_text: Option<String> = None;
        let mut saw_tool_activity = false;
        let mut tool_names_by_id: HashMap<String, String> = HashMap::new();
        let mut tool_inputs_by_id: HashMap<String, Option<Value>> = HashMap::new();
        let mut error_output = String::new();
        let mut session_started_emitted = false;
        let mut new_session_id: Option<String> = None;
        let mut stream_error: Option<String> = None;
        let mut first_stdout_line_ms: Option<u128> = None;
        let mut stdout_line_count: usize = 0;

        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut child_exited_at: Option<std::time::Instant> = None;

        loop {
            let line = tokio::select! {
                line = lines.next_line() => match line {
                    Ok(Some(line)) => line,
                    Ok(None) => break,
                    Err(error) => {
                        // A read error is not EOF: keep the diagnostic so the
                        // turn settles as failed instead of silently succeeding.
                        if !error_output.is_empty() {
                            error_output.push('\n');
                        }
                        error_output.push_str(&format!("[pi stdout read error] {error}"));
                        break;
                    }
                },
                _ = tokio::time::sleep(PI_STDOUT_EXIT_POLL) => {
                    if child_exited_at.is_none() {
                        let mut active = self.active_processes.lock().await;
                        match active.get_mut(turn_id) {
                            Some(process) => {
                                if matches!(process.child.try_wait(), Ok(Some(_))) {
                                    child_exited_at = Some(std::time::Instant::now());
                                }
                            }
                            // Removed externally (interrupt): stop reading; the
                            // killer owns the child handle from here.
                            None => break,
                        }
                    }
                    if child_exited_at.is_some_and(|at| at.elapsed() >= PI_POST_EXIT_GRACE) {
                        log::warn!(
                            "[pi/send] turn={} stdout EOF grace elapsed after child exit; stop reading",
                            turn_id
                        );
                        break;
                    }
                    continue;
                }
            };
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            stdout_line_count += 1;
            if first_stdout_line_ms.is_none() {
                first_stdout_line_ms = Some(turn_started_at.elapsed().as_millis());
            }
            match serde_json::from_str::<Value>(&line) {
                Ok(event) => match parse_pi_stream_line(&event) {
                    PiStreamLine::SessionId(session_id) => {
                        if !session_started_emitted {
                            session_started_emitted = true;
                            new_session_id = Some(session_id.clone());
                            self.set_session_id(Some(session_id.clone())).await;
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::SessionStarted {
                                    workspace_id: self.workspace_id.clone(),
                                    session_id,
                                    engine: EngineType::Pi,
                                    turn_id: Some(turn_id.to_string()),
                                },
                            );
                        }
                    }
                    PiStreamLine::TextDelta(delta) => {
                        response_text.push_str(&delta);
                        self.emit_turn_event(
                            turn_id,
                            EngineEvent::TextDelta {
                                workspace_id: self.workspace_id.clone(),
                                text: delta,
                            },
                        );
                    }
                    PiStreamLine::AssistantSnapshot(text) => {
                        authoritative_response_text = Some(text);
                    }
                    PiStreamLine::ThinkingDelta(delta) => {
                        self.emit_turn_event(
                            turn_id,
                            EngineEvent::ReasoningDelta {
                                workspace_id: self.workspace_id.clone(),
                                text: delta,
                            },
                        );
                    }
                    PiStreamLine::ToolStart {
                        tool_id,
                        tool_name,
                        args,
                    } => {
                        saw_tool_activity = true;
                        tool_names_by_id.insert(tool_id.clone(), tool_name.clone());
                        tool_inputs_by_id.insert(tool_id.clone(), args.clone());
                        if is_pi_background_task_tool(&tool_name) {
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::BackgroundTaskStarted {
                                    workspace_id: self.workspace_id.clone(),
                                    tool_id,
                                    tool_name,
                                    input: args,
                                },
                            );
                        } else {
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::ToolStarted {
                                    workspace_id: self.workspace_id.clone(),
                                    tool_id,
                                    tool_name,
                                    input: args,
                                },
                            );
                        }
                    }
                    PiStreamLine::ToolEnd {
                        tool_id,
                        content,
                        is_error,
                    } => {
                        saw_tool_activity = true;
                        let tool_name = tool_names_by_id.get(&tool_id).cloned();
                        let receipt_task = if tool_name
                            .as_deref()
                            .map(is_pi_background_task_tool)
                            .unwrap_or(false)
                            && !is_error
                        {
                            parse_pi_background_task_receipt(event.get("result"))
                        } else {
                            None
                        };
                        if let Some(task) = receipt_task {
                            log_pi_background_task_failure(
                                params.model.as_deref(),
                                "print-json",
                                &task,
                                !response_text.trim().is_empty(),
                                saw_tool_activity,
                            );
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::BackgroundTaskUpdated {
                                    workspace_id: self.workspace_id.clone(),
                                    tool_id: Some(tool_id),
                                    task,
                                    source: "receipt".to_string(),
                                },
                            );
                            continue;
                        }
                        let wrapped_output = match tool_inputs_by_id.get(&tool_id).cloned() {
                            Some(Some(input_value)) => Some(json!({
                                "_input": input_value,
                                "_output": content,
                            })),
                            _ => Some(Value::String(content.clone())),
                        };
                        self.emit_turn_event(
                            turn_id,
                            EngineEvent::ToolCompleted {
                                workspace_id: self.workspace_id.clone(),
                                tool_id,
                                tool_name,
                                output: wrapped_output,
                                error: is_error.then_some(content),
                            },
                        );
                    }
                    PiStreamLine::BackgroundTaskNotification { details, content } => {
                        saw_tool_activity = true;
                        if let Some(task) = parse_pi_background_task_notification(details, &content)
                        {
                            log_pi_background_task_failure(
                                params.model.as_deref(),
                                "print-json",
                                &task,
                                !response_text.trim().is_empty(),
                                saw_tool_activity,
                            );
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::BackgroundTaskUpdated {
                                    workspace_id: self.workspace_id.clone(),
                                    tool_id: None,
                                    task,
                                    source: "notification".to_string(),
                                },
                            );
                        }
                    }
                    PiStreamLine::AssistantError(error) => {
                        stream_error = Some(error);
                    }
                    PiStreamLine::TurnStart
                    | PiStreamLine::TurnEnd
                    | PiStreamLine::Usage(_)
                    | PiStreamLine::Other => {}
                },
                Err(_) => {
                    error_output.push_str(&line);
                    error_output.push('\n');
                }
            }
        }

        if let Some(text) = authoritative_response_text
            .as_deref()
            .filter(|text| !text.trim().is_empty())
        {
            response_text = text.to_string();
        }
        let stdout_eof_ms = turn_started_at.elapsed().as_millis();
        let mut child = {
            let mut active = self.active_processes.lock().await;
            active.remove(turn_id).map(ActivePiChildProcess::into_child)
        };
        let status = if let Some(mut process) = child.take() {
            match tokio::time::timeout(PI_POST_EXIT_GRACE, process.wait()).await {
                Ok(result) => result.ok(),
                Err(_) => {
                    log::warn!("[pi/send] turn={} child wait timed out; killing", turn_id);
                    let _ = process.start_kill();
                    None
                }
            }
        } else {
            None
        };
        let stderr_text = match tokio::time::timeout(PI_STDERR_JOIN_TIMEOUT, stderr_task).await {
            Ok(joined) => joined.unwrap_or_default(),
            Err(_) => {
                log::warn!(
                    "[pi/send] turn={} stderr reader did not finish within timeout; abandoning",
                    turn_id
                );
                String::new()
            }
        };
        if !stderr_text.trim().is_empty() {
            error_output.push_str(&stderr_text);
        }
        let completed_ms = turn_started_at.elapsed().as_millis();
        let status_success = status.as_ref().is_some_and(|value| value.success());
        log::info!(
            "[pi/send][timing] turn={} spawn_ms={} first_stdout_line_ms={:?} stdout_eof_ms={} completed_ms={} stdout_lines={} status_success={} response_chars={}",
            turn_id,
            spawn_ms,
            first_stdout_line_ms,
            stdout_eof_ms,
            completed_ms,
            stdout_line_count,
            status_success,
            response_text.chars().count(),
        );

        let was_interrupted = self.interrupted_turns.lock().await.remove(turn_id);
        if let Some(error) = stream_error {
            log_pi_failure_envelope(
                params.model.as_deref(),
                "print-json",
                "foreground",
                &error,
                None,
                !response_text.trim().is_empty(),
                saw_tool_activity,
            );
            self.emit_error(turn_id, error.clone());
            return Err(error);
        }
        if let Some(status) = status {
            if !status.success() {
                let error_msg = if was_interrupted {
                    "Session stopped.".to_string()
                } else if !error_output.trim().is_empty() {
                    error_output.trim().to_string()
                } else {
                    format!("PI exited with status: {status}")
                };
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        } else if was_interrupted {
            let error_msg = "Session stopped.".to_string();
            self.emit_error(turn_id, error_msg.clone());
            return Err(error_msg);
        }

        if response_text.trim().is_empty() && !error_output.trim().is_empty() && !saw_tool_activity
        {
            let error_msg = error_output.trim().to_string();
            self.emit_error(turn_id, error_msg.clone());
            return Err(error_msg);
        }

        if response_text.trim().is_empty() && !saw_tool_activity {
            let diagnostic = "PI exited without assistant output.".to_string();
            self.emit_error(turn_id, diagnostic.clone());
            return Err(diagnostic);
        }

        if let Some(session_id) = new_session_id {
            self.set_session_id(Some(session_id)).await;
        }

        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnCompleted {
                workspace_id: self.workspace_id.clone(),
                result: Some(json!({
                    "text": response_text,
                })),
            },
        );

        Ok(response_text)
    }

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

impl Drop for PiSession {
    fn drop(&mut self) {
        let clients: Vec<Arc<PiRpcClient>> = if let Ok(mut map) = self.residents.try_write() {
            map.drain().map(|(_, resident)| resident.client).collect()
        } else if let Ok(map) = self.residents.try_read() {
            map.values()
                .map(|resident| resident.client.clone())
                .collect()
        } else {
            log::warn!(
                "[pi] dropping session workspace={} while residents lock is held",
                self.workspace_id
            );
            Vec::new()
        };
        for client in clients {
            tokio::spawn(async move {
                client.kill().await;
            });
        }
        let Ok(mut active) = self.active_processes.try_lock() else {
            log::warn!(
                "[pi] dropping session workspace={} while active_processes is locked",
                self.workspace_id
            );
            return;
        };
        if active.is_empty() {
            return;
        }
        for (turn_id, process) in active.drain() {
            let mut child = process.into_child();
            let pid = child.id();
            match child.start_kill() {
                Ok(()) => {
                    log::info!(
                        "[pi] drop fallback kill workspace={} turn={} pid={:?}",
                        self.workspace_id,
                        turn_id,
                        pid
                    );
                }
                Err(error) => {
                    log::warn!(
                        "[pi] drop fallback failed workspace={} turn={} pid={:?}: {}",
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn resident_map_key_isolates_sessions_and_new_sends() {
        assert_eq!(
            pi_resident_map_key(Some("abc-123"), "t1"),
            "session:abc-123"
        );
        assert_eq!(
            pi_resident_map_key(Some("abc-123"), "t2"),
            "session:abc-123"
        );
        assert_eq!(pi_resident_map_key(None, "t1"), "scratch:t1");
        assert_ne!(
            pi_resident_map_key(None, "t1"),
            pi_resident_map_key(None, "t2")
        );
        assert_ne!(
            pi_resident_map_key(Some("sess-a"), "t"),
            pi_resident_map_key(Some("sess-b"), "t")
        );
        // thread ids with `pi:` prefix are not valid CLI session args — they
        // must not collide with an established session slot.
        assert_eq!(pi_resident_map_key(Some("pi:abc-123"), "t1"), "scratch:t1");
    }

    #[test]
    fn parallel_sends_do_not_share_resident_keys() {
        let a = pi_resident_map_key(Some("sess-a"), "turn-1");
        let b = pi_resident_map_key(Some("sess-b"), "turn-1");
        let new_1 = pi_resident_map_key(None, "turn-1");
        let new_2 = pi_resident_map_key(None, "turn-2");
        assert_ne!(a, b);
        assert_ne!(new_1, new_2);
        assert_ne!(a, new_1);
        // same session + different turns still share the process (steer, not spawn)
        assert_eq!(
            pi_resident_map_key(Some("sess-a"), "turn-1"),
            pi_resident_map_key(Some("sess-a"), "turn-9")
        );
    }

    #[test]
    fn print_json_fallback_busy_only_blocks_same_session() {
        // 新会话（None）从不因 print-json 占用被挡：各自 spawn 全新 JSONL。
        assert!(!print_json_fallback_busy(
            [None, Some("sess-a")].into_iter(),
            None
        ));
        // 同 session 并发 print-json 必须互斥（交叉写同一 session JSONL）。
        assert!(print_json_fallback_busy(
            [Some("sess-a")].into_iter(),
            Some("sess-a")
        ));
        // 不同 session 并行允许。
        assert!(!print_json_fallback_busy(
            [Some("sess-a")].into_iter(),
            Some("sess-b")
        ));
        // 仅有新会话进程时，历史会话不被误挡。
        assert!(!print_json_fallback_busy(
            [None].into_iter(),
            Some("sess-a")
        ));
        // 空占用一律放行。
        assert!(!print_json_fallback_busy(
            std::iter::empty(),
            Some("sess-a")
        ));
    }

    #[test]
    fn fallback_drop_key_matches_rpc_scratch_key() {
        // send_message fallback 释放的 key 必须与 try_send_message_rpc 的
        // scratch_key 同源（pi_resident_map_key(session_id, turn_id)），
        // 否则 session_id=None / 非法 id 时 resident 泄漏。
        assert_eq!(pi_resident_map_key(None, "turn-1"), "scratch:turn-1");
        assert_eq!(
            pi_resident_map_key(Some("pi:x"), "turn-1"),
            "scratch:turn-1"
        );
        assert_eq!(
            pi_resident_map_key(Some("abc-123"), "turn-1"),
            "session:abc-123"
        );
    }

    #[test]
    fn rpc_disabled_latch_blocks_within_cooldown_and_allows_probe_after() {
        let t0 = Instant::now();
        // 未置位：不拦。
        assert!(!rpc_disabled_blocks_spawn(None, t0));
        // 冷却期内：拦（含窗口右端点前 1s）。
        assert!(rpc_disabled_blocks_spawn(
            Some(t0),
            t0 + Duration::from_secs(10)
        ));
        assert!(rpc_disabled_blocks_spawn(
            Some(t0),
            t0 + PI_RPC_DISABLED_RETRY_COOLDOWN - Duration::from_secs(1)
        ));
        // 冷却边界及之后：放行试探。
        assert!(!rpc_disabled_blocks_spawn(
            Some(t0),
            t0 + PI_RPC_DISABLED_RETRY_COOLDOWN
        ));
        assert!(!rpc_disabled_blocks_spawn(
            Some(t0),
            t0 + PI_RPC_DISABLED_RETRY_COOLDOWN * 2
        ));
    }

    // OpenSpec change：fix-orphan-turn-during-backend-unavailability（F2）。
    #[tokio::test]
    async fn send_gate_rpc_spawn_blocked_reads_latch_readonly() {
        let dir = std::env::temp_dir().join(format!("pi-send-gate-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        // 未置位：不拦。
        assert!(!session.rpc_spawn_blocked().await);
        // 置位后冷却期内：拦。
        *session.rpc_disabled_since.lock().await = Some(Instant::now());
        assert!(session.rpc_spawn_blocked().await);
        // 只读语义：查询不改变闩状态（不清闩不自愈）。
        assert!(session.rpc_disabled_since.lock().await.is_some());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn send_gate_print_json_fallback_blocked_empty_map_is_false() {
        let dir = std::env::temp_dir().join(format!("pi-send-gate-empty-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        // 无活跃子进程：任何 session（含 None / Some）都不 busy。
        assert!(!session.print_json_fallback_blocked(None).await);
        assert!(!session.print_json_fallback_blocked(Some("s1")).await);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn prewarm_resident_rejects_invalid_session_id_without_spawning() {
        let dir = std::env::temp_dir().join(format!("pi-prewarm-invalid-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        // 空 / flag 形态 / 非法字符：直接拒绝，不到 spawn。
        assert!(session.prewarm_resident("").await.is_err());
        assert!(session.prewarm_resident("--model").await.is_err());
        assert!(session.prewarm_resident("bad/id").await.is_err());
        assert!(session.residents.read().await.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn prewarm_resident_respects_rpc_disabled_latch() {
        let dir = std::env::temp_dir().join(format!("pi-prewarm-latch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        // 闩冷却期内：合法 session id 同样拒绝（与 ensure_resident 同源 gate），
        // 且不得搅动闩自愈状态。
        *session.rpc_disabled_since.lock().await = Some(Instant::now());
        let error = session
            .prewarm_resident("validsession1")
            .await
            .expect_err("latch must block prewarm");
        assert!(error.contains("pi rpc disabled"));
        assert!(session.rpc_disabled_since.lock().await.is_some());
        assert!(session.residents.read().await.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn rpc_prompt_expands_at_file_text_and_images_without_colliding() {
        let dir = std::env::temp_dir().join(format!(
            "pi-rpc-at-file-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let notes = dir.join("notes.md");
        let shot = dir.join("shot.png");
        std::fs::write(&notes, "hello from notes").unwrap();
        std::fs::write(&shot, [0x89, b'P', b'N', b'G']).unwrap();
        let prompt = format!("@{} 总结 @{}", notes.display(), shot.display());
        let expanded = expand_rpc_prompt_attachments(&prompt, None, &dir).expect("expand");
        assert!(
            expanded.text.contains("hello from notes"),
            "text attachment must be inlined: {}",
            expanded.text
        );
        assert!(
            expanded.images.iter().any(|p| p.ends_with("shot.png")),
            "image @file must join images[]: {:?}",
            expanded.images
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn plan_rpc_send_mode_steers_whenever_pi_is_active() {
        assert_eq!(plan_rpc_send_mode(false, false), RpcSendMode::Prompt);
        assert_eq!(plan_rpc_send_mode(true, false), RpcSendMode::Steer);
        // 本地无 run 但 pi 自唤醒 turn 在跑：必须 steer，否则裸 prompt 被
        // pi 以 "already processing" 拒绝（用户可见「会话失败」）。
        assert_eq!(plan_rpc_send_mode(false, true), RpcSendMode::Steer);
        assert_eq!(plan_rpc_send_mode(true, true), RpcSendMode::Steer);
    }

    #[test]
    fn rpc_busy_error_matches_only_pi_already_processing() {
        assert!(is_rpc_busy_error(
            "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message."
        ));
        assert!(!is_rpc_busy_error("No model selected"));
        assert!(!is_rpc_busy_error("OAuth token expired"));
        assert!(!is_rpc_busy_error(""));
    }

    #[test]
    fn orphan_run_ids_are_unique_and_marked() {
        let a = PiRpcRun::new_orphan();
        let b = PiRpcRun::new_orphan();
        assert!(a.orphan && b.orphan);
        assert_ne!(a.main_turn_id, b.main_turn_id);
        assert!(a.main_turn_id.starts_with("pi-external-"));
    }

    #[test]
    fn orphan_run_backfills_last_assistant_text_after_notification() {
        let mut run = PiRpcRun::new_orphan();
        run.saw_tool_activity = true;
        assert!(should_backfill_last_assistant_text(&run));
    }

    #[test]
    fn tool_only_foreground_run_does_not_backfill_stale_text() {
        let (tx, _rx) = oneshot::channel();
        let mut run = PiRpcRun::new("turn-main", tx, None);
        run.saw_tool_activity = true;
        assert!(!should_backfill_last_assistant_text(&run));
    }

    #[test]
    fn orphan_run_adopts_user_turn_for_followups_without_rewriting_prior_stream() {
        let mut run = PiRpcRun::new_orphan();
        let synthetic_id = run.main_turn_id.clone();
        run.response_text.push_str("外部回合正文");
        run.pending_turn_ids.push_back("turn-user-1".to_string());
        assert_eq!(bind_next_native_turn_id(&mut run), "turn-user-1");
        assert!(!run.orphan);
        assert_eq!(run.main_turn_id, "turn-user-1");
        assert_ne!(run.main_turn_id, synthetic_id);
        assert_eq!(bind_next_native_turn_id(&mut run), "turn-user-1:t1");
        assert_eq!(run.response_text, "外部回合正文");
    }

    #[test]
    fn foreground_run_binds_derived_ids_for_followup_native_turns() {
        // 实测 pi 0.84.4：一个 run 内每个工具往返都是一个新原生 turn。
        // 用户自己 run 的后续原生 turn 是前台流，必须派生 `{main}:t{n}`
        // id（daemon 无条件放行），而不是 pi-external-* 合成 id。
        let (tx, _rx) = oneshot::channel();
        let mut run = PiRpcRun::new("pi-turn-primary", tx, None);
        assert!(!run.orphan);
        assert_eq!(bind_next_native_turn_id(&mut run), "pi-turn-primary:t1");
        assert_eq!(bind_next_native_turn_id(&mut run), "pi-turn-primary:t2");
    }

    #[test]
    fn pending_user_turn_id_wins_over_derived_native_id() {
        let (tx, _rx) = oneshot::channel();
        let mut run = PiRpcRun::new("pi-turn-primary", tx, None);
        run.pending_turn_ids.push_back("turn-steer-1".to_string());
        assert_eq!(bind_next_native_turn_id(&mut run), "turn-steer-1");
        assert_eq!(bind_next_native_turn_id(&mut run), "pi-turn-primary:t1");
    }

    #[test]
    fn orphan_run_binds_external_ids_for_followup_native_turns() {
        let mut run = PiRpcRun::new_orphan();
        let first = bind_next_native_turn_id(&mut run);
        let second = bind_next_native_turn_id(&mut run);
        assert!(first.starts_with("pi-external-"));
        assert!(second.starts_with("pi-external-"));
        assert_ne!(first, second);
    }

    #[test]
    fn probe_replay_run1_two_native_turns_commit_per_turn() {
        // 回放 2026-08-30 探针实测序列（run 1）：
        // agent_start → turn_start → assistant#1(text1+bg_run×2) → turn_end
        // → turn_start → assistant#2(text2) → turn_end → agent_end → agent_settled
        let (tx, mut rx) = oneshot::channel();
        let mut run = PiRpcRun::new("pi-turn-primary", tx, None);
        let events = std::cell::RefCell::new(Vec::<(String, EngineEvent)>::new());
        let emit = |turn_id: &str, event: EngineEvent| {
            events.borrow_mut().push((turn_id.to_string(), event));
        };

        // turn 1：thinking/text deltas + message_end 快照（text1）。
        // 首 turn 不走 bind：active_turn_id 就是 main（与 pump 一致）。
        assert_eq!(run.active_turn_id, "pi-turn-primary");
        for delta in ["好的，", "并行启动两个后台任务。"] {
            run.response_text.push_str(delta);
            emit(
                &run.active_turn_id,
                EngineEvent::TextDelta {
                    workspace_id: "ws".into(),
                    text: delta.into(),
                },
            );
        }
        run.authoritative_text = Some("好的，并行启动两个后台任务。".to_string());
        commit_rpc_turn("ws", &mut run, &emit);
        // turn 2：run 内第二个原生 turn，派生前台 id。
        run.active_turn_id = bind_next_native_turn_id(&mut run);
        assert_eq!(run.active_turn_id, "pi-turn-primary:t1");
        run.response_text.push_str("两个任务已并行启动：");
        run.authoritative_text = Some("两个任务已并行启动：".to_string());
        commit_rpc_turn("ws", &mut run, &emit);

        let events = events.borrow();
        let completed: Vec<(String, String)> = events
            .iter()
            .filter_map(|(id, event)| match event {
                EngineEvent::TurnCompleted { result, .. } => Some((
                    id.clone(),
                    result
                        .as_ref()
                        .and_then(|r| r.get("text"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                )),
                _ => None,
            })
            .collect();
        assert_eq!(
            completed,
            vec![
                (
                    "pi-turn-primary".to_string(),
                    "好的，并行启动两个后台任务。".to_string()
                ),
                (
                    "pi-turn-primary:t1".to_string(),
                    "两个任务已并行启动：".to_string()
                ),
            ]
        );
        // 主 waiter 在第一个原生 turn 就结算（bg 等待/前台流不阻塞发送边）。
        let settled = rx.try_recv().expect("main waiter settles");
        assert_eq!(settled.as_deref(), Ok("好的，并行启动两个后台任务。"));
    }

    #[test]
    fn commit_rpc_turn_prefers_authoritative_snapshot_and_settles_waiter() {
        let (tx, mut rx) = oneshot::channel();
        let mut run = PiRpcRun::new("turn-main", tx, None);
        run.response_text.push_str("partial");
        run.authoritative_text = Some("complete response".to_string());
        let events = std::cell::RefCell::new(Vec::<(String, EngineEvent)>::new());
        commit_rpc_turn("ws", &mut run, &|turn_id, event| {
            events.borrow_mut().push((turn_id.to_string(), event));
        });
        assert!(matches!(
            &events.borrow()[0],
            (id, EngineEvent::TurnCompleted { result, .. })
                if id == "turn-main"
                    && result.as_ref().and_then(|r| r.get("text")).and_then(Value::as_str)
                        == Some("complete response")
        ));
        assert_eq!(
            rx.try_recv().expect("main waiter settles").as_deref(),
            Ok("complete response")
        );
    }

    #[test]
    fn settle_non_orphan_run_keeps_main_text_attached_empty() {
        // 非 orphan same-run steer 语义不回归：main（waiters[0]）取全文，
        // attached 取空文本。
        let (main_tx, _main_rx) = oneshot::channel();
        let mut run = PiRpcRun::new(
            "turn-main",
            main_tx,
            Some("openai-codex/gpt-5.6".to_string()),
        );
        run.response_text.push_str("hello");
        let (tx, _rx) = oneshot::channel();
        run.attached_turn_ids.push("turn-attached".to_string());
        run.waiters.push(("turn-attached".to_string(), tx));
        let events = std::cell::RefCell::new(Vec::<(String, EngineEvent)>::new());
        settle_rpc_run("ws", run, None, &|turn_id, event| {
            events.borrow_mut().push((turn_id.to_string(), event));
        });
        let events = events.borrow();
        assert_eq!(events.len(), 2);
        assert!(matches!(
            &events[0],
            (id, EngineEvent::TurnCompleted { result, .. })
                if id == "turn-main"
                && result.as_ref().and_then(|r| r.get("text")).and_then(Value::as_str) == Some("hello")
        ));
        assert!(matches!(
            &events[1],
            (id, EngineEvent::TurnCompleted { result, .. })
                if id == "turn-attached"
                && result.as_ref().and_then(|r| r.get("text")).and_then(Value::as_str) == Some("")
        ));
    }

    #[test]
    fn rpc_provider_error_after_tool_activity_remains_an_error() {
        let (tx, _rx) = oneshot::channel();
        let mut run = PiRpcRun::new("turn-main", tx, Some("openai-codex/gpt-5.6".to_string()));
        run.saw_tool_activity = true;
        run.stream_error = Some("fetch failed".to_string());
        let events = std::cell::RefCell::new(Vec::<EngineEvent>::new());
        settle_rpc_run("ws", run, None, &|_, event| events.borrow_mut().push(event));
        assert!(matches!(
            events.borrow().first(),
            Some(EngineEvent::TurnError { error, .. }) if error == "fetch failed"
        ));
    }

    #[test]
    fn pi_failure_category_keeps_fetch_and_auth_distinct() {
        assert_eq!(pi_failure_category("fetch failed"), "upstream_transport");
        assert_eq!(pi_failure_category("OAuth token expired"), "authentication");
        assert_eq!(
            pi_failure_category("pi rpc process exited"),
            "local_process_exit"
        );
    }

    #[test]
    fn pi_background_task_failure_detects_exit_one_without_payload_logging() {
        assert!(pi_background_task_failure(&json!({
            "id": "task-1",
            "status": "failed",
            "exitCode": 1,
        })));
        assert!(!pi_background_task_failure(&json!({
            "id": "task-2",
            "status": "completed",
            "exitCode": 0,
        })));
    }

    #[test]
    fn turn_watchdog_silence_budget_covers_compact_and_tick() {
        // auto-compaction 在 turn 收尾可能长时无流式事件：静默预算必须
        // 覆盖 compact 预算，否则 compact 中的 turn 会被误判超时。
        assert!(PI_RPC_TURN_SILENCE_TIMEOUT > crate::engine::pi_rpc::PI_RPC_COMPACT_TIMEOUT);
        assert!(PI_RPC_TURN_WATCHDOG_TICK < PI_RPC_TURN_SILENCE_TIMEOUT);
    }

    #[test]
    fn parses_session_id() {
        let line = json!({"type":"session","id":"abc-123","cwd":"/tmp"});
        match parse_pi_stream_line(&line) {
            PiStreamLine::SessionId(id) => assert_eq!(id, "abc-123"),
            _ => panic!("expected SessionId"),
        }
    }

    #[test]
    fn parses_text_and_thinking_deltas() {
        let text = json!({
            "type":"message_update",
            "assistantMessageEvent":{"type":"text_delta","delta":"hi"}
        });
        match parse_pi_stream_line(&text) {
            PiStreamLine::TextDelta(d) => assert_eq!(d, "hi"),
            _ => panic!("expected TextDelta"),
        }
        let think = json!({
            "type":"message_update",
            "assistantMessageEvent":{"type":"thinking_delta","delta":"plan"}
        });
        match parse_pi_stream_line(&think) {
            PiStreamLine::ThinkingDelta(d) => assert_eq!(d, "plan"),
            _ => panic!("expected ThinkingDelta"),
        }
    }

    #[test]
    fn parses_authoritative_assistant_snapshot_and_turn_boundaries() {
        let snapshot = json!({
            "type": "message_end",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "complete "},
                    {"type": "output_text", "text": "response"}
                ]
            }
        });
        match parse_pi_stream_line(&snapshot) {
            PiStreamLine::AssistantSnapshot(text) => assert_eq!(text, "complete response"),
            _ => panic!("expected authoritative assistant snapshot"),
        }
        assert!(matches!(
            parse_pi_stream_line(&json!({"type": "turn_start"})),
            PiStreamLine::TurnStart
        ));
        assert!(matches!(
            parse_pi_stream_line(&json!({"type": "turn_end"})),
            PiStreamLine::TurnEnd
        ));
    }

    #[test]
    fn parses_tool_events() {
        let start = json!({
            "type":"tool_execution_start",
            "toolCallId":"t1",
            "toolName":"bash",
            "args":{"command":"ls"}
        });
        match parse_pi_stream_line(&start) {
            PiStreamLine::ToolStart {
                tool_id,
                tool_name,
                args,
            } => {
                assert_eq!(tool_id, "t1");
                assert_eq!(tool_name, "bash");
                assert_eq!(args, Some(json!({"command":"ls"})));
            }
            _ => panic!("expected ToolStart"),
        }
        let end = json!({
            "type":"tool_execution_end",
            "toolCallId":"t1",
            "isError":false,
            "result":{"content":[{"type":"text","text":"ok"}]}
        });
        match parse_pi_stream_line(&end) {
            PiStreamLine::ToolEnd {
                tool_id,
                content,
                is_error,
            } => {
                assert_eq!(tool_id, "t1");
                assert_eq!(content, "ok");
                assert!(!is_error);
            }
            _ => panic!("expected ToolEnd"),
        }
    }

    #[test]
    fn background_task_tool_list_hits_launch_tools_only() {
        for name in [
            "bg_run",
            "bg_delegate",
            "bg_run_pi_attested",
            "fusion_reason",
            "fusion_investigate",
            "fusion_research",
            "fusion_validate",
        ] {
            assert!(is_pi_background_task_tool(name), "{name} should hit");
        }
        for name in [
            "bg_status",
            "bg_logs",
            "bg_kill",
            "bg_result",
            "bash",
            "read",
            "todo_write",
            "",
        ] {
            assert!(!is_pi_background_task_tool(name), "{name} should miss");
        }
    }

    #[test]
    fn background_task_receipt_prefers_structured_details() {
        // Spike 2026-08-26: bg_run receipt carries the full snapshot at
        // result.details.task.
        let result = json!({
            "content":[{"type":"text","text":"Started background task spike-task (b2e2f48ad)\nStatus: running\nPID: 26137\nOutput: .pi/tasks/session-1-1/b2e2f48ad.output"}],
            "details":{"task":{"id":"b2e2f48ad","name":"spike-task","status":"running","outputPath":".pi/tasks/session-1-1/b2e2f48ad.output","pid":26137}}
        });
        let task = parse_pi_background_task_receipt(Some(&result)).expect("receipt parses");
        assert_eq!(task.get("id").and_then(Value::as_str), Some("b2e2f48ad"));
        assert_eq!(task.get("name").and_then(Value::as_str), Some("spike-task"));
        assert_eq!(
            task.get("outputPath").and_then(Value::as_str),
            Some(".pi/tasks/session-1-1/b2e2f48ad.output")
        );
    }

    #[test]
    fn background_task_receipt_text_fallback_without_details() {
        let result = json!({
            "content":[{"type":"text","text":"Started background task spike-task (b2e2f48ad)\nStatus: running\nPID: 26137\nOutput: .pi/tasks/session-1-1/b2e2f48ad.output\nTerminal notification: enabled."}]
        });
        let task = parse_pi_background_task_receipt(Some(&result)).expect("text receipt parses");
        assert_eq!(task.get("id").and_then(Value::as_str), Some("b2e2f48ad"));
        assert_eq!(task.get("name").and_then(Value::as_str), Some("spike-task"));
        assert_eq!(task.get("status").and_then(Value::as_str), Some("running"));
        assert_eq!(
            task.get("outputPath").and_then(Value::as_str),
            Some(".pi/tasks/session-1-1/b2e2f48ad.output")
        );
        assert_eq!(task.get("pid").and_then(Value::as_u64), Some(26137));
    }

    #[test]
    fn background_task_receipt_parse_failure_degrades_to_none() {
        // 非 bg receipt 文本 / 空结果：None → 调用方降级普通工具卡。
        let alien = json!({"content":[{"type":"text","text":"total 0\ndrwxr-xr-x 2 wheel 64"}]});
        assert!(parse_pi_background_task_receipt(Some(&alien)).is_none());
        assert!(parse_pi_background_task_receipt(None).is_none());
        let empty = json!({"content":[{"type":"text","text":""}]});
        assert!(parse_pi_background_task_receipt(Some(&empty)).is_none());
    }

    #[test]
    fn background_task_notification_stream_line_surfaces_message_start_only() {
        let start = json!({
            "type":"message_start",
            "message":{
                "role":"custom",
                "customType":"background-task-notification",
                "content":"<background-task-notification>\n  <task-id>b2e2f48ad</task-id>\n  <status>completed</status>\n</background-task-notification>",
                "details":{"id":"b2e2f48ad","name":"spike-task","status":"completed","exitCode":0}
            }
        });
        match parse_pi_stream_line(&start) {
            PiStreamLine::BackgroundTaskNotification { details, content } => {
                assert!(content.contains("<task-id>b2e2f48ad</task-id>"));
                let task = parse_pi_background_task_notification(details, &content)
                    .expect("details snapshot parses");
                assert_eq!(
                    task.get("status").and_then(Value::as_str),
                    Some("completed")
                );
                assert_eq!(task.get("exitCode").and_then(Value::as_i64), Some(0));
            }
            _ => panic!("expected BackgroundTaskNotification"),
        }
        // message_end 携带相同 payload：去重为 Other。
        let mut end = start.clone();
        end["type"] = json!("message_end");
        assert!(matches!(parse_pi_stream_line(&end), PiStreamLine::Other));
    }

    #[test]
    fn background_task_notification_extracts_description_without_machine_fields() {
        let content = "<background-task-notification><task-id>x</task-id><status>completed</status><summary>Hello world 5s</summary><exit-code>0</exit-code></background-task-notification>";
        let task =
            parse_pi_background_task_notification(None, content).expect("notification parses");
        assert_eq!(
            task.get("completionText").and_then(Value::as_str),
            Some("Hello world 5s")
        );
        assert!(task.get("task-id").is_none());
        assert!(task.get("exit-code").is_none());
    }

    #[test]
    fn structured_notification_drops_machine_summary_but_keeps_result() {
        let content = "<background-task-notification><task-id>x</task-id><summary>Background task \"Sleep 10s task\" completed</summary><result>content output</result></background-task-notification>";
        let task = parse_pi_background_task_notification(
            Some(json!({
                "id":"x",
                "status":"completed",
                "exitCode":0,
                "completionText":"Background task \"Sleep 10s task\" completed",
                "result":"real output"
            })),
            content,
        )
        .expect("structured notification parses");
        assert_eq!(
            task.get("completionText").and_then(Value::as_str),
            Some("content output")
        );
    }

    #[test]
    fn background_task_notification_content_fallback_without_details() {
        let start = json!({
            "type":"message_start",
            "message":{
                "role":"custom",
                "customType":"background-task-notification",
                "content":"<background-task-notification>\n  <task-id>b_abc</task-id>\n  <task-name>legacy-task</task-name>\n  <status>failed</status>\n  <exit-code>137</exit-code>\n  <output-file>.pi/tasks/session-1-1/b_abc.output</output-file>\n</background-task-notification>"
            }
        });
        match parse_pi_stream_line(&start) {
            PiStreamLine::BackgroundTaskNotification { details, content } => {
                let task = parse_pi_background_task_notification(details, &content)
                    .expect("content envelope parses");
                assert_eq!(task.get("id").and_then(Value::as_str), Some("b_abc"));
                assert_eq!(
                    task.get("name").and_then(Value::as_str),
                    Some("legacy-task")
                );
                assert_eq!(task.get("status").and_then(Value::as_str), Some("failed"));
                assert_eq!(task.get("exitCode").and_then(Value::as_i64), Some(137));
                assert_eq!(
                    task.get("outputPath").and_then(Value::as_str),
                    Some(".pi/tasks/session-1-1/b_abc.output")
                );
            }
            _ => panic!("expected BackgroundTaskNotification"),
        }
    }

    #[test]
    fn non_notification_custom_messages_stay_other() {
        let line = json!({
            "type":"message_start",
            "message":{"role":"custom","customType":"some-other-extension","content":"hi"}
        });
        assert!(matches!(parse_pi_stream_line(&line), PiStreamLine::Other));
    }

    #[test]
    fn parses_auth_error_on_message_start() {
        let line = json!({
            "type":"message_start",
            "message":{
                "role":"assistant",
                "errorMessage":"401 Invalid bearer token"
            }
        });
        match parse_pi_stream_line(&line) {
            PiStreamLine::AssistantError(err) => assert!(err.contains("401")),
            _ => panic!("expected AssistantError"),
        }
    }

    #[test]
    fn parses_live_print_json_turn_without_dropping_text() {
        // Captured from `pi --print --mode json` 0.84.1 on this machine:
        // session → thinking deltas → one text_delta "pong" → turn_end.
        let events = [
            json!({"type":"session","id":"01a0073b-b1da-77a1-a9e3-390cf2c88680"}),
            json!({
                "type":"message_update",
                "assistantMessageEvent":{"type":"thinking_delta","delta":"The user wants "}
            }),
            json!({
                "type":"message_update",
                "assistantMessageEvent":{"type":"text_delta","delta":"pong"}
            }),
            json!({"type":"turn_end"}),
            json!({"type":"agent_end"}),
            json!({"type":"agent_settled"}),
        ];

        let parsed: Vec<PiStreamLine> = events.iter().map(parse_pi_stream_line).collect();
        assert!(matches!(
            &parsed[0],
            PiStreamLine::SessionId(id) if id == "01a0073b-b1da-77a1-a9e3-390cf2c88680"
        ));
        assert!(matches!(
            &parsed[1],
            PiStreamLine::ThinkingDelta(delta) if delta == "The user wants "
        ));
        assert!(matches!(
            &parsed[2],
            PiStreamLine::TextDelta(delta) if delta == "pong"
        ));
        assert!(matches!(parsed[3], PiStreamLine::TurnEnd));
        assert!(matches!(parsed[4], PiStreamLine::Other));
        assert!(matches!(parsed[5], PiStreamLine::Other));
    }

    #[test]
    fn model_and_thinking_flags_filter_defaults() {
        assert_eq!(resolve_model_flag(Some("auto")), None);
        assert_eq!(
            resolve_model_flag(Some("anthropic/claude-sonnet-5")),
            Some("anthropic/claude-sonnet-5".to_string())
        );
        assert_eq!(
            resolve_thinking_flag(Some("high")),
            Some("high".to_string())
        );
        assert_eq!(resolve_thinking_flag(Some("nope")), None);
    }

    #[test]
    fn pick_thinking_level_uses_model_allowlist() {
        let available = vec!["off".to_string(), "high".to_string()];
        assert_eq!(
            pick_thinking_level(Some("high"), Some(available.as_slice())),
            Some("high".to_string())
        );
        assert_eq!(
            pick_thinking_level(Some("xhigh"), Some(available.as_slice())),
            None
        );
        assert_eq!(
            pick_thinking_level(Some("xhigh"), None),
            Some("xhigh".to_string())
        );
    }

    #[test]
    fn split_provider_model_only_first_segment_is_provider() {
        assert_eq!(
            split_provider_model("kimi-coding/k3"),
            Some(("kimi-coding".to_string(), "k3".to_string()))
        );
        // openrouter 等模型 id 自带斜杠：只有首段是 provider。
        assert_eq!(
            split_provider_model("openrouter/openai/gpt-4o"),
            Some(("openrouter".to_string(), "openai/gpt-4o".to_string()))
        );
        assert_eq!(split_provider_model("k3"), None);
        assert_eq!(split_provider_model("/k3"), None);
        assert_eq!(split_provider_model("kimi-coding/"), None);
    }

    #[test]
    fn model_reconcile_plan_matrix() {
        // 未显式指定（auto/default）：不动 resident。
        assert_eq!(
            plan_rpc_model_reconcile(None, None),
            RpcModelReconcile::Skip
        );
        assert_eq!(
            plan_rpc_model_reconcile(None, Some(("minimax-cn", "MiniMax-M3"))),
            RpcModelReconcile::Skip
        );
        // resident 已是目标模型：no-op。
        assert_eq!(
            plan_rpc_model_reconcile(Some("kimi-coding/k3"), Some(("kimi-coding", "k3"))),
            RpcModelReconcile::Match
        );
        // 漂移（裸 spawn 钉死 config 默认模型 / 用户切模型）：set_model。
        assert_eq!(
            plan_rpc_model_reconcile(Some("kimi-coding/k3"), Some(("minimax-cn", "MiniMax-M3"))),
            RpcModelReconcile::Set {
                provider: "kimi-coding".to_string(),
                model_id: "k3".to_string()
            }
        );
        // resident state 缺 model（未刷新）：也要 set_model 纠正。
        assert_eq!(
            plan_rpc_model_reconcile(Some("deepseek/deepseek-v4-flash"), None),
            RpcModelReconcile::Set {
                provider: "deepseek".to_string(),
                model_id: "deepseek-v4-flash".to_string()
            }
        );
        // 裸 id：与 resident 同 id 即匹配；不同则无法精确对账，仅 warn。
        assert_eq!(
            plan_rpc_model_reconcile(Some("k3"), Some(("kimi-coding", "k3"))),
            RpcModelReconcile::Match
        );
        assert_eq!(
            plan_rpc_model_reconcile(Some("k3"), Some(("minimax-cn", "MiniMax-M3"))),
            RpcModelReconcile::BareMismatch("k3".to_string())
        );
        assert_eq!(
            plan_rpc_model_reconcile(Some("k3"), None),
            RpcModelReconcile::BareMismatch("k3".to_string())
        );
    }

    fn command_args(cmd: &Command) -> Vec<String> {
        cmd.as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect()
    }

    #[test]
    fn build_command_attaches_images_as_at_file_args_before_prompt() {
        let dir = std::env::temp_dir().join(format!("pi-cmd-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let image = dir.join("shot one.png");
        std::fs::write(&image, b"fake-png").unwrap();
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: "look at this".to_string(),
            images: Some(vec![image.to_string_lossy().to_string()]),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);

        let at_arg = format!("@{}", image.display());
        let at_pos = args
            .iter()
            .position(|arg| arg == &at_arg)
            .expect("missing @file arg");
        let prompt_pos = args
            .iter()
            .rposition(|arg| arg.contains("look at this"))
            .expect("missing prompt arg");
        assert!(at_pos < prompt_pos, "@file arg must precede the prompt");
        let prompt = &args[prompt_pos];
        assert!(!prompt.contains("mossx:pi-image-attachments"));
        assert!(!prompt.contains("read tool"));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_without_images_has_no_at_file_args() {
        let dir = std::env::temp_dir().join(format!("pi-cmd-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: "plain".to_string(),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);
        assert!(!args.iter().any(|arg| arg.starts_with('@')));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_fails_when_all_images_unresolvable() {
        let dir = std::env::temp_dir().join(format!("pi-cmd-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: "look".to_string(),
            images: Some(vec![dir.join("missing.png").to_string_lossy().to_string()]),
            ..Default::default()
        };

        let error = session
            .build_command(&params)
            .expect_err("unresolvable images must fail before spawn");
        assert!(error.contains("none of the attached images"));

        let _ = std::fs::remove_dir_all(dir);
    }

    fn make_workspace_with_files(files: &[&str]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pi-cmd-test-{}", uuid::Uuid::new_v4()));
        for relative in files {
            let path = dir.join(relative);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(&path, b"payload").unwrap();
        }
        dir
    }

    #[test]
    fn build_command_extracts_leading_at_file_reference_to_argv() {
        let dir = make_workspace_with_files(&["design.md"]);
        let file = dir.join("design.md");
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: format!("@{} 总结一下", file.display()),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);

        let at_arg = format!("@{}", file.display());
        let at_pos = args
            .iter()
            .position(|arg| arg == &at_arg)
            .expect("missing @file arg");
        let prompt_pos = args
            .iter()
            .rposition(|arg| arg.contains("总结一下"))
            .expect("missing prompt arg");
        assert!(at_pos < prompt_pos, "@file arg must precede the prompt");
        let prompt = &args[prompt_pos];
        assert!(
            !prompt.contains("design.md"),
            "extracted token must leave the prompt"
        );
        assert!(!prompt.starts_with('@'), "prompt must not start with '@'");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_resolves_at_reference_with_spaces_greedily() {
        let dir = make_workspace_with_files(&["shot one.png"]);
        let file = dir.join("shot one.png");
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: format!("看下 @{} 这张图", file.display()),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);

        let at_arg = format!("@{}", file.display());
        assert!(
            args.iter().any(|arg| arg == &at_arg),
            "spaced path must resolve as one @file arg: {args:?}"
        );
        let prompt = args.last().expect("prompt arg");
        assert!(prompt.contains("看下"), "prompt keeps surrounding text");
        assert!(prompt.contains("这张图"), "prompt keeps trailing text");
        assert!(!prompt.contains("shot one.png"));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_resolves_relative_at_reference_against_workspace() {
        let dir = make_workspace_with_files(&["docs/a.md"]);
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: "@docs/a.md 读一下".to_string(),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);

        let at_arg = format!("@{}", dir.join("docs/a.md").display());
        assert!(args.iter().any(|arg| arg == &at_arg), "args: {args:?}");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_keeps_folder_reference_as_plain_text() {
        let dir = make_workspace_with_files(&["sub/placeholder.txt"]);
        let folder = dir.join("sub");
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: format!("@{} 这两个设计移到 docs", folder.display()),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);

        let folder_at = format!("@{}", folder.display());
        assert!(
            !args.iter().any(|arg| arg == &folder_at),
            "folder must not become an @file arg"
        );
        let prompt = args.last().expect("prompt arg");
        assert!(prompt.contains(&folder.display().to_string()));
        assert!(
            !prompt.starts_with('@'),
            "leading unresolvable @ token must be space-guarded: {prompt:?}"
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_keeps_missing_path_and_mention_as_plain_text() {
        let dir = make_workspace_with_files(&[]);
        let missing = dir.join("missing.md");
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: format!("@teammate 帮忙看下 @{}", missing.display()),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);

        assert!(
            !args.iter().any(|arg| arg.starts_with('@')),
            "unresolvable tokens must not produce @file args: {args:?}"
        );
        let prompt = args.last().expect("prompt arg");
        assert!(prompt.contains("@teammate"));
        assert!(prompt.contains("missing.md"));
        assert!(!prompt.starts_with('@'));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_dedupes_reference_against_image_attachment() {
        let dir = make_workspace_with_files(&["a.png"]);
        let file = dir.join("a.png");
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: format!("@{} 看看", file.display()),
            images: Some(vec![file.to_string_lossy().to_string()]),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);

        let at_arg = format!("@{}", file.display());
        let count = args.iter().filter(|arg| *arg == &at_arg).count();
        assert_eq!(count, 1, "same path must appear exactly once: {args:?}");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn interrupt_unknown_turn_is_idempotent() {
        let session = PiSession::new("ws".to_string(), std::env::temp_dir(), None);
        session.interrupt_turn("missing").await.expect("idempotent");
        assert!(session.interrupted_turns.lock().await.is_empty());
    }
}
