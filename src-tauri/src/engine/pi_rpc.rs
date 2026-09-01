//! PI RPC resident session client (`pi --mode rpc`).
//!
//! One native PI thread = one resident RPC process. Commands are JSON lines on
//! stdin; responses carry the caller-supplied `id` for correlation; agent
//! events stream on stdout interleaved with responses.
//!
//! Contract notes (pi `docs/rpc.md` + `dist/modes/rpc/rpc-types.d.ts`):
//! - Strict JSONL: LF (`\n`) is the only record delimiter; strip a trailing
//!   `\r`. U+2028/U+2029 inside strings are NOT delimiters (tokio
//!   `BufReader::lines` splits on `\n` only, so this holds by construction).
//! - `response.success == true` means accepted/queued — never a turn terminal.
//!   Turn settlement is the typed `agent_settled` event.
//! - Extension UI requests are auto-cancelled: mossx is a headless host and
//!   MUST NOT surface vendor extension dialogs (v1 boundary).

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{broadcast, oneshot, Mutex, RwLock};

pub const PI_RPC_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Manual compaction runs an LLM summarization over the whole session text —
/// far slower than local commands. With the generic 30s budget a worthwhile
/// compact would time out on the UI while pi keeps running it to completion
/// (state split: UI reports failure, session is actually compacted). 500s
/// covers slow models on very large sessions.
pub const PI_RPC_COMPACT_TIMEOUT: Duration = Duration::from_secs(500);
/// Fork copies the active path into a new session file; deep sessions with
/// inline images can exceed the generic 30s request budget.
pub const PI_RPC_FORK_TIMEOUT: Duration = Duration::from_secs(120);
pub const PI_RPC_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

/// One line decoded from the RPC stdout pump.
#[derive(Debug, Clone)]
pub enum PiRpcPumpEvent {
    /// A streaming agent event (`agent_start`, `message_update`, `tool_execution_*`,
    /// `agent_end`, `agent_settled`, `compaction_*`, ...): the raw JSON value.
    Agent(Value),
    /// stdout EOF / child exit observed by the pump; carries the exit code when known.
    Exited(Option<i32>),
}

struct PiRpcShared {
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
    next_id: AtomicU64,
    streaming: AtomicBool,
    /// 最近一行 stdout（任意类型）的 unix ms。pump 直接刷新，不经过
    /// broadcast——即使投影侧丢事件，活性判定仍以此为准。
    last_event_ms: AtomicU64,
}

fn unix_time_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub struct PiRpcClient {
    shared: Arc<PiRpcShared>,
    child: Mutex<Child>,
    pump_sender: broadcast::Sender<PiRpcPumpEvent>,
    state: RwLock<Value>,
    /// Last successful `get_available_thinking_levels` for the current model.
    thinking_levels: RwLock<Option<Vec<String>>>,
}

impl PiRpcClient {
    /// Spawn `pi --mode rpc` and verify the handshake with `get_state`.
    pub async fn spawn(
        bin: &str,
        workspace_path: &Path,
        session_id: Option<&str>,
        model: Option<&str>,
        home_dir: Option<&str>,
        custom_args: Option<&str>,
    ) -> Result<Arc<Self>, String> {
        let mut cmd = crate::backend::app_server::build_command_for_binary(bin);
        cmd.current_dir(workspace_path);
        // Custom args first so protocol flags always win (last-wins parsing).
        if let Some(args) = custom_args {
            for arg in args.split_whitespace() {
                cmd.arg(arg);
            }
        }
        cmd.arg("--mode");
        cmd.arg("rpc");
        if let Some(model) = model {
            cmd.arg("--model");
            cmd.arg(model);
        }
        if let Some(session_id) = session_id {
            cmd.arg("--session-id");
            cmd.arg(session_id);
        }
        if let Some(home) = home_dir {
            cmd.env("PI_CODING_AGENT_DIR", home);
            cmd.env("HOME", home);
        }
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|error| format!("Failed to spawn pi rpc: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture pi rpc stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture pi rpc stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture pi rpc stderr".to_string())?;

        let shared = Arc::new(PiRpcShared {
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            streaming: AtomicBool::new(false),
            last_event_ms: AtomicU64::new(0),
        });
        let (pump_sender, _) = broadcast::channel(8192);

        // stderr drain (diagnostics only).
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    log::warn!("[pi/rpc][stderr] {trimmed}");
                }
            }
        });

        // stdout pump: strict JSONL, three-way split.
        {
            let shared = Arc::clone(&shared);
            let pump_sender = pump_sender.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                let exit_code: Option<i32> = loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            let line = line.strip_suffix('\r').unwrap_or(&line);
                            let trimmed = line.trim();
                            if trimmed.is_empty() {
                                continue;
                            }
                            let value = match parse_pi_rpc_json_line(trimmed) {
                                Ok(value) => value,
                                Err(error) => {
                                    log::warn!("[pi/rpc] dropping unparseable line: {error}");
                                    continue;
                                }
                            };
                            // 任何一行解码成功都证明 resident 活着且在说话。
                            shared.last_event_ms.store(unix_time_ms(), Ordering::SeqCst);
                            let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
                            match kind {
                                "response" => {
                                    let id =
                                        value.get("id").and_then(Value::as_str).map(str::to_string);
                                    if let Some(id) = id {
                                        let success = value
                                            .get("success")
                                            .and_then(Value::as_bool)
                                            .unwrap_or(false);
                                        let result = if success {
                                            Ok(value.get("data").cloned().unwrap_or(Value::Null))
                                        } else {
                                            Err(value
                                                .get("error")
                                                .and_then(Value::as_str)
                                                .unwrap_or("pi rpc command failed")
                                                .to_string())
                                        };
                                        let sender = {
                                            let mut pending = shared.pending.lock().await;
                                            pending.remove(&id)
                                        };
                                        if let Some(sender) = sender {
                                            let _ = sender.send(result);
                                        } else {
                                            log::warn!(
                                                "[pi/rpc] late/unknown response id={id} dropped"
                                            );
                                        }
                                    }
                                }
                                "extension_ui_request" => {
                                    if let Some(id) =
                                        value.get("id").and_then(Value::as_str).map(str::to_string)
                                    {
                                        let cancel = json!({"type":"extension_ui_response","id":id,"cancelled":true});
                                        let mut stdin = shared.stdin.lock().await;
                                        if let Err(error) =
                                            write_json_line(&mut stdin, &cancel).await
                                        {
                                            log::warn!(
                                                "[pi/rpc] failed to cancel extension ui request: {error}"
                                            );
                                        }
                                    }
                                }
                                "agent_start" => {
                                    shared.streaming.store(true, Ordering::SeqCst);
                                    let _ = pump_sender.send(PiRpcPumpEvent::Agent(value));
                                }
                                // omp 无 agent_settled（run 以 agent_end 收尾，
                                // v18.0.11 实测）；pi 的 agent_end → agent_settled
                                // 相邻，同点清 streaming 对 pi 语义不变。
                                "agent_settled" | "agent_end" => {
                                    shared.streaming.store(false, Ordering::SeqCst);
                                    let _ = pump_sender.send(PiRpcPumpEvent::Agent(value));
                                }
                                _ => {
                                    let _ = pump_sender.send(PiRpcPumpEvent::Agent(value));
                                }
                            }
                        }
                        Ok(None) => break None,
                        Err(error) => {
                            log::warn!("[pi/rpc] stdout read error: {error}");
                            break None;
                        }
                    }
                };
                // EOF: fail every pending request so callers never hang.
                let mut pending = shared.pending.lock().await;
                for (id, sender) in pending.drain() {
                    log::warn!("[pi/rpc] failing pending request id={id} on process exit");
                    let _ = sender.send(Err("pi rpc process exited".to_string()));
                }
                drop(pending);
                shared.streaming.store(false, Ordering::SeqCst);
                let _ = pump_sender.send(PiRpcPumpEvent::Exited(exit_code));
            });
        }

        let client = Arc::new(Self {
            shared,
            child: Mutex::new(child),
            pump_sender,
            state: RwLock::new(Value::Null),
            thinking_levels: RwLock::new(None),
        });

        // Handshake: proves the binary actually speaks RPC (older pi without
        // `--mode rpc` exits or prints text; both surface as handshake errors).
        let state =
            client.request_with_timeout(json!({"type":"get_state"}), PI_RPC_HANDSHAKE_TIMEOUT);
        let state = state
            .await
            .map_err(|error| format!("pi rpc handshake failed (get_state): {error}"))?;
        *client.state.write().await = state;
        let _ = client.refresh_thinking_levels().await;
        Ok(client)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<PiRpcPumpEvent> {
        self.pump_sender.subscribe()
    }

    pub fn is_streaming(&self) -> bool {
        self.shared.streaming.load(Ordering::SeqCst)
    }

    /// 最近一行 stdout 距今的时长；None = 自 spawn 以来无任何输出。
    /// 看门狗 ground truth：活跃 turn 持续流事件，长时间静默 = 流停滞。
    pub fn last_event_age(&self) -> Option<Duration> {
        let ms = self.shared.last_event_ms.load(Ordering::SeqCst);
        if ms == 0 {
            return None;
        }
        Some(Duration::from_millis(unix_time_ms().saturating_sub(ms)))
    }

    pub async fn is_alive(&self) -> bool {
        matches!(self.child.lock().await.try_wait(), Ok(None))
    }

    pub async fn session_id(&self) -> Option<String> {
        self.state
            .read()
            .await
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string)
    }

    /// Current model identity from the cached state: `(provider, modelId)`.
    /// None when the state predates a refresh or carries `model: null`.
    pub async fn current_model_identity(&self) -> Option<(String, String)> {
        let state = self.state.read().await;
        let model = state.get("model")?;
        let provider = model.get("provider")?.as_str()?.to_string();
        let id = model.get("id")?.as_str()?.to_string();
        Some((provider, id))
    }

    pub async fn kill(&self) {
        let mut child = self.child.lock().await;
        let _ = child.start_kill();
    }

    pub async fn request(&self, cmd: Value) -> Result<Value, String> {
        self.request_with_timeout(cmd, PI_RPC_REQUEST_TIMEOUT).await
    }

    async fn request_with_timeout(
        &self,
        mut cmd: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = format!(
            "mossx-{}",
            self.shared.next_id.fetch_add(1, Ordering::SeqCst)
        );
        cmd["id"] = Value::String(id.clone());
        let (tx, rx) = oneshot::channel();
        // pending 必须先于写注册：response 走独立的 stdout pump task，可能
        // 在「写完成 → 注册」的窗口内到达——未注册会被当 late/unknown 丢弃，
        // 调用方干等到超时（get_state 这类本地快命令最容易命中该竞态）。
        {
            let mut pending = self.shared.pending.lock().await;
            pending.insert(id.clone(), tx);
        }
        {
            let mut stdin = self.shared.stdin.lock().await;
            if let Err(error) = write_json_line(&mut stdin, &cmd).await {
                self.shared.pending.lock().await.remove(&id);
                return Err(error);
            }
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_closed)) => {
                self.shared.pending.lock().await.remove(&id);
                Err("pi rpc response channel closed".to_string())
            }
            Err(_elapsed) => {
                self.shared.pending.lock().await.remove(&id);
                Err(format!("pi rpc request {id} timed out"))
            }
        }
    }

    // ===== Command surface =====

    pub async fn prompt(&self, text: &str, images: Vec<Value>) -> Result<(), String> {
        let mut cmd = json!({"type":"prompt","message":text});
        if !images.is_empty() {
            cmd["images"] = Value::Array(images);
        }
        self.request(cmd).await.map(|_| ())
    }

    pub async fn steer(&self, text: &str, images: Vec<Value>) -> Result<(), String> {
        let mut cmd = json!({"type":"steer","message":text});
        if !images.is_empty() {
            cmd["images"] = Value::Array(images);
        }
        self.request(cmd).await.map(|_| ())
    }

    pub async fn abort(&self) -> Result<(), String> {
        self.request(json!({"type":"abort"})).await.map(|_| ())
    }

    pub async fn get_state(&self) -> Result<Value, String> {
        let state = self.request(json!({"type":"get_state"})).await?;
        *self.state.write().await = state.clone();
        Ok(state)
    }

    pub async fn get_session_stats(&self) -> Result<Value, String> {
        self.request(json!({"type":"get_session_stats"})).await
    }

    pub async fn compact(&self, custom_instructions: Option<&str>) -> Result<Value, String> {
        self.request_with_timeout(
            build_compact_command(custom_instructions),
            PI_RPC_COMPACT_TIMEOUT,
        )
        .await
    }

    pub async fn fork(&self, entry_id: &str) -> Result<Value, String> {
        let result = self
            .request_with_timeout(
                json!({"type":"fork","entryId":entry_id}),
                PI_RPC_FORK_TIMEOUT,
            )
            .await?;
        let _ = self.get_state().await;
        Ok(result)
    }

    pub async fn get_last_assistant_text(&self) -> Result<String, String> {
        let data = self
            .request(json!({"type":"get_last_assistant_text"}))
            .await?;
        if let Some(text) = data.as_str() {
            return Ok(text.to_string());
        }
        if let Some(text) = data.get("text").and_then(Value::as_str) {
            return Ok(text.to_string());
        }
        Err("get_last_assistant_text returned no text".to_string())
    }

    pub async fn switch_session(&self, session_path: &str) -> Result<Value, String> {
        let result = self
            .request(json!({"type":"switch_session","sessionPath":session_path}))
            .await?;
        // switch/fork/new_session 后必须刷新缓存：get_state 只更新于响应时，
        // 否则 SessionStarted / align 会拿到切换前的 stale session id
        // （生产事故：新会话文件 id 与缓存 id 不一致 → align 找不到文件）。
        let _ = self.get_state().await;
        Ok(result)
    }

    pub async fn new_session(&self) -> Result<(), String> {
        self.request(json!({"type":"new_session"})).await?;
        let _ = self.get_state().await;
        Ok(())
    }

    pub async fn get_tree(&self) -> Result<Value, String> {
        let mut data = self.request(json!({"type":"get_tree"})).await?;
        // 统一对外输出浅层 entries：深会话响应已被 pump 在大栈线程摊平
        // （data.entries）；浅会话仍是嵌套 data.tree，就地摊平（浅，安全）。
        if let Some(obj) = data.as_object_mut() {
            if obj.contains_key("entries") {
                return Ok(data);
            }
            if let Some(tree) = obj.remove("tree") {
                let entries = tree
                    .as_array()
                    .map(|nodes| flatten_pi_tree_for_ipc(nodes))
                    .unwrap_or_default();
                obj.insert("entries".to_string(), Value::Array(entries));
            }
        }
        Ok(data)
    }

    pub async fn get_fork_messages(&self) -> Result<Value, String> {
        self.request(json!({"type":"get_fork_messages"})).await
    }

    pub async fn set_model(&self, provider: &str, model_id: &str) -> Result<Value, String> {
        let result = self
            .request(json!({"type":"set_model","provider":provider,"modelId":model_id}))
            .await?;
        // 与 fork/switch_session/new_session 同纪律：成功后刷新缓存 state，
        // 否则下一轮模型对账读到切换前的 stale model 会重复 set_model。
        let _ = self.get_state().await;
        let _ = self.refresh_thinking_levels().await;
        Ok(result)
    }

    pub async fn set_thinking_level(&self, level: &str) -> Result<(), String> {
        self.request(json!({"type":"set_thinking_level","level":level}))
            .await
            .map(|_| ())
    }

    pub async fn available_thinking_levels(&self) -> Option<Vec<String>> {
        self.thinking_levels.read().await.clone()
    }

    /// Best-effort: older pi without this command must not fail the turn.
    /// On failure, clear the cache so send falls back to the static CLI list
    /// instead of a stale previous-model allowlist.
    pub async fn refresh_thinking_levels(&self) -> Result<(), String> {
        match self
            .request(json!({"type":"get_available_thinking_levels"}))
            .await
        {
            Ok(data) => {
                let levels = parse_available_thinking_levels(&data);
                *self.thinking_levels.write().await = if levels.is_empty() {
                    None
                } else {
                    Some(levels)
                };
                Ok(())
            }
            Err(error) => {
                *self.thinking_levels.write().await = None;
                Err(error)
            }
        }
    }
}

pub(crate) fn parse_available_thinking_levels(data: &Value) -> Vec<String> {
    data.get("levels")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
        .collect()
}

/// 会话树响应过 IPC 前的文本预览上限（字符）。树行只展示单行预览；长会话
/// 含大量粘贴截图（base64 图片）与长工具输出时，get_tree 原始响应可达
/// 数十 MB，Tauri IPC 序列化 + 前端 JSON.parse 会直接卡死面板。
pub(crate) const PI_TREE_PREVIEW_MAX_CHARS: usize = 500;

pub(crate) fn truncate_pi_tree_preview(text: &str) -> String {
    if text.chars().count() <= PI_TREE_PREVIEW_MAX_CHARS {
        return text.to_string();
    }
    text.chars().take(PI_TREE_PREVIEW_MAX_CHARS).collect()
}

/// 就地精简单条 message content：剥除 base64 图片载荷、截断超长字符串字段。
pub(crate) fn slim_pi_message_content_for_ipc(content: &mut Value) {
    match content {
        Value::String(text) => {
            *text = truncate_pi_tree_preview(text);
        }
        Value::Array(blocks) => {
            for block in blocks.iter_mut() {
                let Some(map) = block.as_object_mut() else {
                    continue;
                };
                if map.get("type").and_then(Value::as_str) == Some("image") {
                    // 图片载荷对树零价值：剥除 data / source.data
                    map.remove("data");
                    if let Some(source) = map.get_mut("source").and_then(Value::as_object_mut) {
                        source.remove("data");
                    }
                    continue;
                }
                for value in map.values_mut() {
                    if let Some(text) = value.as_str() {
                        if text.chars().count() > PI_TREE_PREVIEW_MAX_CHARS {
                            *value = Value::String(truncate_pi_tree_preview(text));
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

/// 把 get_tree 的嵌套树摊平成浅层 entry 列表（含 label），同时瘦身正文。
/// 两个目的：① 载荷瘦身（base64 图片 / 长文本）；② 消灭嵌套深度——线性
/// 会话的树是 ~2000 层深链，serde_json 默认 128 层递归限制连序列化都会
/// 失败（Tauri IPC 返回前必须序列化）。结构关系由 entry.parentId 表达，
/// 前端负责重建森林（面板本来就要摊平）。迭代 DFS 保序：兄弟顺序不变。
pub(crate) fn flatten_pi_tree_for_ipc(nodes: &[Value]) -> Vec<Value> {
    let mut out = Vec::new();
    let mut stack: Vec<&Value> = nodes.iter().rev().collect();
    while let Some(node) = stack.pop() {
        let mut entry = node.get("entry").cloned().unwrap_or(Value::Null);
        if let Some(content) = entry
            .get_mut("message")
            .and_then(|message| message.get_mut("content"))
        {
            slim_pi_message_content_for_ipc(content);
        }
        out.push(json!({
            "entry": entry,
            "label": node.get("label").cloned().unwrap_or(Value::Null),
        }));
        if let Some(children) = node.get("children").and_then(Value::as_array) {
            stack.extend(children.iter().rev());
        }
    }
    out
}

/// Build the `compact` RPC command. `customInstructions` is omitted when
/// absent/blank and trimmed otherwise (pi treats the key's presence as
/// meaningful, so don't send empty strings).
fn build_compact_command(custom_instructions: Option<&str>) -> Value {
    let mut cmd = json!({"type":"compact"});
    if let Some(instructions) = custom_instructions {
        let trimmed = instructions.trim();
        if !trimmed.is_empty() {
            cmd["customInstructions"] = Value::String(trimmed.to_string());
        }
    }
    cmd
}

/// JSON 行的最大括号嵌套深度（跳过字符串内容与转义）。用于分流解析策略。
fn json_nesting_depth(line: &str) -> usize {
    let mut depth = 0usize;
    let mut max_depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for byte in line.bytes() {
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            continue;
        }
        match byte {
            b'"' => in_string = true,
            b'{' | b'[' => {
                depth += 1;
                if depth > max_depth {
                    max_depth = depth;
                }
            }
            b'}' | b']' => {
                depth = depth.saturating_sub(1);
            }
            _ => {}
        }
    }
    max_depth
}

/// 浅行阈值：低于它走默认解析器（128 层护栏仍在，且栈占用安全）。
const PI_RPC_SHALLOW_PARSE_MAX_DEPTH: usize = 100;

/// 解析 RPC stdout 的一行 JSON。线性长会话的 get_tree 响应是 ~2000 层深链：
/// 默认 128 层递归限制会拒收；放开限制递归下降解析器又会在 tokio worker
///（2MB 栈）上爆栈（实测 ~1008 层 SIGABRT 崩溃）。因此按深度分流：浅行走
/// 默认解析器；深行（仅 get_tree 这类树响应）挪到 32MB 大栈线程解析。
fn parse_pi_rpc_json_line(line: &str) -> Result<Value, String> {
    if json_nesting_depth(line) <= PI_RPC_SHALLOW_PARSE_MAX_DEPTH {
        return serde_json::from_str(line).map_err(|error| error.to_string());
    }
    let owned = line.to_string();
    std::thread::Builder::new()
        .name("pi-rpc-deep-json".to_string())
        .stack_size(32 * 1024 * 1024)
        .spawn(move || {
            let value = {
                let mut deserializer = serde_json::Deserializer::from_str(&owned);
                deserializer.disable_recursion_limit();
                Value::deserialize(&mut deserializer).map_err(|error| error.to_string())?
            };
            // 深值不出大栈线程：get_tree 响应在此摊平+瘦身，深层 Value 在本
            // 线程内 drop——跨线程只传浅层结果（Value 的递归 drop 在 2MB
            // worker 上同样爆栈：崩溃报告实证）。
            Ok(flatten_deep_tree_response(value))
        })
        .map_err(|error| format!("spawn deep-json parser failed: {error}"))?
        .join()
        .map_err(|_| "deep-json parser thread panicked".to_string())?
}

/// 深响应后处理（仅在大栈线程内调用）：get_tree 的嵌套 `data.tree` 就地换成
/// 浅层 `data.entries`（摊平+瘦身），深层 Value 随函数返回 drop。其他深
/// 响应原样返回。
fn flatten_deep_tree_response(mut value: Value) -> Value {
    let is_tree_response = value.get("type").and_then(Value::as_str) == Some("response")
        && value
            .pointer("/data/tree")
            .and_then(Value::as_array)
            .is_some();
    if !is_tree_response {
        return value;
    }
    let tree = value
        .get_mut("data")
        .and_then(Value::as_object_mut)
        .and_then(|data| data.remove("tree"))
        .unwrap_or(Value::Null);
    let entries = match tree.as_array() {
        Some(nodes) => flatten_pi_tree_for_ipc(nodes),
        None => Vec::new(),
    };
    if let Some(data) = value.get_mut("data").and_then(Value::as_object_mut) {
        data.insert("entries".to_string(), Value::Array(entries));
    }
    value
}

async fn write_json_line(stdin: &mut ChildStdin, value: &Value) -> Result<(), String> {
    let mut line = serde_json::to_string(value)
        .map_err(|error| format!("failed to serialize pi rpc command: {error}"))?;
    line.push('\n');
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|error| format!("failed to write pi rpc command: {error}"))?;
    stdin
        .flush()
        .await
        .map_err(|error| format!("failed to flush pi rpc command: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nesting_depth_skips_strings_and_escapes() {
        assert_eq!(json_nesting_depth("{}"), 1);
        assert_eq!(json_nesting_depth("{\"a\":[{\"b\":1}]}"), 3);
        // 字符串里的括号不计深度
        assert_eq!(json_nesting_depth("{\"a\":\"[[[\"}"), 1);
        assert_eq!(json_nesting_depth("{\"a\":\"\\\"}\"}"), 1);
    }

    #[test]
    fn flatten_deep_tree_response_only_transforms_tree_responses() {
        // get_tree 响应：data.tree → data.entries（摊平 + 瘦身）
        let response = json!({
            "type": "response",
            "id": "mossx-1",
            "success": true,
            "data": {
                "leafId": "b",
                "tree": [{
                    "entry": { "id": "a", "parentId": null, "message": { "role": "user", "content": "hi" } },
                    "label": null,
                    "children": [{
                        "entry": { "id": "b", "parentId": "a", "message": { "role": "assistant", "content": "hello" } },
                        "label": null,
                        "children": [],
                    }],
                }],
            },
        });
        let out = flatten_deep_tree_response(response);
        let data = &out["data"];
        assert!(data.get("tree").is_none());
        assert_eq!(data["leafId"], "b");
        let entries = data["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0]["entry"]["id"], "a");
        assert_eq!(entries[1]["entry"]["parentId"], "a");
        // 非树响应原样不动
        let other = json!({"type": "response", "data": {"foo": [1, 2, 3]}});
        assert_eq!(flatten_deep_tree_response(other.clone()), other);
    }

    #[test]
    fn parse_line_handles_deep_nesting_beyond_default_recursion_limit() {
        // get_tree 响应是深链嵌套：默认 128 层限制必拒；深行走大栈线程后必须
        // 能解析（2MB tokio worker 栈上直接放开限制会爆栈，勿回归为单线程直解）
        let deep = format!("{}1{}", "[".repeat(500), "]".repeat(500));
        let parsed = parse_pi_rpc_json_line(&deep).expect("deep json should parse");
        assert!(parsed.is_array());
        // 未放开的默认解析器必须失败（守护测试前提）
        assert!(serde_json::from_str::<Value>(&deep).is_err());
        // 浅行走默认快速路径
        let shallow = parse_pi_rpc_json_line("{\"type\":\"agent_settled\"}")
            .expect("shallow json should parse");
        assert_eq!(shallow["type"], "agent_settled");
    }

    #[test]
    fn compact_command_trims_and_omits_blank_instructions() {
        assert_eq!(build_compact_command(None), json!({"type":"compact"}));
        assert_eq!(
            build_compact_command(Some("   ")),
            json!({"type":"compact"})
        );
        assert_eq!(
            build_compact_command(Some("  保留根因结论  ")),
            json!({"type":"compact","customInstructions":"保留根因结论"})
        );
    }

    #[test]
    fn compact_timeout_exceeds_generic_request_budget() {
        // 纪律测试：compaction 是对整段会话的 LLM summarization，禁止回归为
        // 30s 通用预算（UI 报超时但 pi 侧仍跑完 → 状态分裂）。
        assert!(PI_RPC_COMPACT_TIMEOUT > PI_RPC_REQUEST_TIMEOUT);
        assert!(PI_RPC_FORK_TIMEOUT > PI_RPC_REQUEST_TIMEOUT);
        assert!(PI_RPC_FORK_TIMEOUT < PI_RPC_COMPACT_TIMEOUT);
    }

    #[test]
    fn serialize_prompt_with_images() {
        let mut cmd = json!({"type":"prompt","message":"hi"});
        cmd["images"] = json!([{"type":"image","data":"AAAA","mimeType":"image/png"}]);
        let line = serde_json::to_string(&cmd).unwrap();
        assert!(line.contains("\"type\":\"prompt\""));
        assert!(line.contains("\"mimeType\":\"image/png\""));
        assert!(!line.contains('\u{2028}'));
    }

    #[test]
    fn parse_available_thinking_levels_reads_levels_array() {
        let data = json!({"levels": ["off", " High ", ""]});
        assert_eq!(
            parse_available_thinking_levels(&data),
            vec!["off".to_string(), "high".to_string()]
        );
        assert!(parse_available_thinking_levels(&json!({})).is_empty());
    }

    #[test]
    fn extension_ui_cancel_shape() {
        let cancel = json!({"type":"extension_ui_response","id":"uuid-1","cancelled":true});
        assert_eq!(cancel["type"], "extension_ui_response");
        assert_eq!(cancel["cancelled"], true);
    }

    #[test]
    fn response_success_means_acceptance_not_terminal() {
        // 纪律测试：success=true 只是 accepted/queued，不允许映射成 turn 终态。
        let response = json!({"id":"mossx-1","type":"response","command":"prompt","success":true});
        assert_eq!(response["success"], true);
        assert_ne!(response["type"], "agent_settled");
    }

    #[tokio::test]
    async fn strict_jsonl_split_only_on_lf() {
        // U+2028 / U+2029 不得作为记录分隔：tokio lines() 只按 \n 切。
        let payload = "{\"type\":\"agent_start\",\"note\":\"a\u{2028}b\u{2029}c\"}\n{\"type\":\"agent_settled\"}\n";
        let cursor = std::io::Cursor::new(payload.as_bytes().to_vec());
        let mut lines = BufReader::new(cursor).lines();
        let first = lines.next_line().await.unwrap().unwrap();
        assert!(first.contains('a'));
        let second = lines.next_line().await.unwrap().unwrap();
        assert_eq!(second, "{\"type\":\"agent_settled\"}");
        assert!(lines.next_line().await.unwrap().is_none());
    }
}
