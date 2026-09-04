use super::*;

/// RPC resident path: a turn is settled by typed `agent_settled`, not process
/// EOF. 不按墙钟杀 turn（长 agentic 任务合法地跑几十分钟）：看门狗周期性
/// 与 resident 实况对账，只有持续静默才判超时。
pub(crate) const PI_RPC_TURN_WATCHDOG_TICK: Duration = Duration::from_secs(30);

/// 真超时判据：resident 完全静默（无任何 stdout 行）超过该预算才判死。
/// 必须覆盖 PI_RPC_COMPACT_TIMEOUT(500s)——auto-compaction 在 turn 收尾
/// 阶段同样可能长时间无流式事件。
pub(crate) const PI_RPC_TURN_SILENCE_TIMEOUT: Duration = Duration::from_secs(900);

/// After `abort`, give pi this long to settle before killing the resident.
pub(crate) const PI_RPC_ABORT_SETTLE_GRACE: Duration = Duration::from_secs(2);

/// `rpc_disabled` 闩的冷却期：置位后该窗口内拦新 spawn；窗口过后放行一次
/// 试探 spawn（成功清闩自愈，失败重新计时）。60s 覆盖 pi 二进制升级/资源
/// 瞬态耗尽；持续故障下每窗口最多白试一次（~2s handshake），不退化成每次
/// 发送都白 spawn。
pub(crate) const PI_RPC_DISABLED_RETRY_COOLDOWN: Duration = Duration::from_secs(60);

/// 禁用闩是否拦截本次新 spawn：未置位不拦；冷却期内拦；冷却过后放行一
/// 次试探（纯函数，便于单测冷却矩阵）。
pub(crate) fn rpc_disabled_blocks_spawn(disabled_since: Option<Instant>, now: Instant) -> bool {
    match disabled_since {
        None => false,
        Some(since) => now.duration_since(since) < PI_RPC_DISABLED_RETRY_COOLDOWN,
    }
}

/// One `pi --mode rpc` process + the run currently streaming on it.
#[derive(Clone)]
pub(crate) struct PiResident {
    pub(crate) client: Arc<PiRpcClient>,
    pub(crate) run: Arc<RwLock<Option<PiRpcRun>>>,
    /// Serializes send-start vs fork/compact on this session (TOCTOU).
    pub(crate) op_lock: Arc<Mutex<()>>,
    /// True while prompt() is in flight and the run is not registered yet.
    pub(crate) in_flight: Arc<AtomicBool>,
    pub(crate) in_flight_turn: Arc<Mutex<Option<String>>>,
}

/// Map key: established sessions share a process; each new send without a
/// session id gets its own scratch process so it cannot steal another tab.
pub(crate) fn pi_resident_map_key(session_id: Option<&str>, scratch: &str) -> String {
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
pub(crate) struct PiRpcRun {
    pub(crate) main_turn_id: String,
    pub(crate) active_turn_id: String,
    pub(crate) seen_turn_start: bool,
    pub(crate) pending_turn_ids: VecDeque<String>,
    pub(crate) completed_turn_ids: HashSet<String>,
    /// 本 run 内已派生的 follow-up turn 数（非 orphan run 专用）。
    pub(crate) native_turn_seq: usize,
    pub(crate) requested_model: Option<String>,
    pub(crate) attached_turn_ids: Vec<String>,
    pub(crate) waiters: Vec<(String, oneshot::Sender<Result<String, String>>)>,
    pub(crate) response_text: String,
    pub(crate) authoritative_text: Option<String>,
    pub(crate) saw_tool_activity: bool,
    pub(crate) tool_names_by_id: HashMap<String, String>,
    pub(crate) tool_inputs_by_id: HashMap<String, Option<Value>>,
    pub(crate) stream_error: Option<String>,
    pub(crate) abort_requested: bool,
    /// True while the main turn is synthetic：run 承接的是 pi 自唤醒 turn
    /// （bg 任务完成通知注入等，不经过 ccgui 发送路径）。真实用户 turn
    /// 只排队到下一个原生 `turn_start`，不会收养外部正文。
    pub(crate) orphan: bool,
}

impl PiRpcRun {
    pub(crate) fn new(
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
    pub(crate) fn new_orphan(engine: EngineType) -> Self {
        let (tx, _rx) = oneshot::channel();
        let mut run = Self::new(&next_pi_external_turn_id(engine), tx, None);
        run.orphan = true;
        run
    }
}

/// pi 族外部唤醒 turn id：`<engine>-external-*`（omp 与 pi 前缀分列，
/// daemon/app 门控按引擎各自放行，add-omp-engine）。
pub(crate) fn next_pi_external_turn_id(engine: EngineType) -> String {
    static EXTERNAL_TURN_SEQ: AtomicU64 = AtomicU64::new(0);
    let seq = EXTERNAL_TURN_SEQ.fetch_add(1, Ordering::SeqCst);
    format!(
        "{}-external-{}-{seq}",
        engine.icon(),
        unix_timestamp_ms_for_process_diagnostics()
    )
}

/// Bind the next native turn inside an active run.
///
/// 用户 steer 的真实 turn id 优先（pending 队列）。没有排队 turn 时：
/// - orphan run（pi 自唤醒）→ 合成 `<engine>-external-*` id，由 daemon 的
///   外部 turn 门控决定是否投影；
/// - 用户自己的 run → 派生 `{main}:t{n}` id。这是**前台**流的一部分
///   （普通多轮工具对话里每个 assistant 回合都是一个新原生 turn，实测
///   0.84.4），daemon 必须无条件放行，不得套用外部门控。
pub(crate) fn bind_next_native_turn_id(engine: EngineType, run: &mut PiRpcRun) -> String {
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
        return next_pi_external_turn_id(engine);
    }
    run.native_turn_seq += 1;
    format!("{}:t{}", run.main_turn_id, run.native_turn_seq)
}

/// 单 resident 的发送决策：本地有活跃 run 必 steer；本地无 run 但 pi 仍在
/// streaming（pi 自唤醒 turn）也必须 steer——裸 prompt 会被 pi 以
/// "already processing" 拒绝（用户可见「会话失败」）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RpcSendMode {
    Prompt,
    Steer,
}

pub(crate) fn plan_rpc_send_mode(run_active: bool, streaming: bool) -> RpcSendMode {
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
pub(crate) fn is_rpc_busy_error(error: &str) -> bool {
    error.contains("already processing")
}

/// RPC send outcome: `Fallback` means "use the print-json path instead".
/// `Failed` = terminal error NOT yet emitted（send_message 统一发一次）；
/// `Settled` = 错误已随 run 结算发过一次（turn timeout 时全 waiter 一起
/// 结算），send_message 直接返回、禁止二次发 TurnError。
pub(crate) enum PiRpcSendError {
    Fallback(String),
    Failed(String),
    Settled(String),
}

pub(crate) fn should_backfill_last_assistant_text(run: &PiRpcRun) -> bool {
    resolve_rpc_turn_text(run).trim().is_empty() && (run.orphan || !run.saw_tool_activity)
}

pub(crate) fn resolve_rpc_turn_text(run: &PiRpcRun) -> String {
    run.authoritative_text
        .as_deref()
        .filter(|text| !text.trim().is_empty())
        .unwrap_or(&run.response_text)
        .to_string()
}

pub(crate) fn commit_rpc_turn(workspace_id: &str, run: &mut PiRpcRun, emit: &dyn Fn(&str, EngineEvent)) {
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
pub(crate) fn settle_rpc_run(
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

impl PiSession {
    /// Ensure a live RPC resident for THIS session (or a dedicated scratch
    /// process for a brand-new send). Never reuse another session's process
    /// and never fall back to the workspace-level tracked session id.
    pub(crate) async fn ensure_resident(
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

    pub(crate) async fn rekey_resident(&self, from: &str, to: &str) {
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
    pub(crate) fn spawn_rpc_projection(
        &self,
        client: Arc<PiRpcClient>,
        rpc_run: Arc<RwLock<Option<PiRpcRun>>>,
    ) {
        let mut receiver = client.subscribe();
        let event_sender = self.event_sender.clone();
        let residents = self.residents.clone();
        let workspace_id = self.workspace_id.clone();
        let engine = self.engine;
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
                        // omp 无 `agent_settled` 事件（v18.0.11 实测：run 以
                        // `agent_end` 收尾即终态）；pi 维持原生 agent_settled。
                        // omp 的 agent_end 附带 errorMessage 时作为 fatal 结算
                        // （auth 失败等），否则正常 settle。
                        let omp_agent_end_settle =
                            engine == EngineType::Omp && event_type == "agent_end";
                        if event_type == "agent_settled" || omp_agent_end_settle {
                            let settle_fatal = if omp_agent_end_settle {
                                extract_error_message(&value)
                            } else {
                                None
                            };
                            let run = rpc_run.write().await.take();
                            // 生命周期标记：run 彻底 settle（无重试/无排队
                            // continuation）。daemon forwarder 以此判定
                            // 「本 run 真正结束」，避免在第一个原生 turn 的
                            // TurnCompleted 处过早断开、丢掉 run 内后续
                            // 原生 turn（实测 0.84.4 的多 turn 结构）。
                            let settled_marker_turn_id = run
                                .as_ref()
                                .map(|run| run.main_turn_id.clone())
                                .unwrap_or_else(|| format!("{}-settled-{workspace_id}", engine.icon()));
                            if let Some(mut run) = run {
                                // 自唤醒回合通常先收到 custom notification，因而会被
                                // 标记为 tool activity；该回合的 assistant 正文仍可能只
                                // 保存在 resident 的 last assistant message 中。
                                // 普通 tool-only 回合继续禁止回读，避免把上一轮正文带入本轮。
                                if settle_fatal.is_none() && should_backfill_last_assistant_text(&run) {
                                    if let Ok(text) = client.get_last_assistant_text().await {
                                        if !text.trim().is_empty() {
                                            run.response_text = text;
                                        }
                                    }
                                }
                                settle_rpc_run(&workspace_id, run, settle_fatal, &emit);
                            }
                            emit(
                                &settled_marker_turn_id,
                                EngineEvent::Raw {
                                    workspace_id: workspace_id.clone(),
                                    engine,
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
                                turn_id.or_else(|| Some(format!("{}-compact-{}", engine.icon(), workspace_id)));
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
                                        engine,
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
                            *guard = Some(PiRpcRun::new_orphan(engine));
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
                                    run.active_turn_id = bind_next_native_turn_id(engine, run);
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
    pub(crate) async fn try_send_message_rpc(
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
    pub(crate) async fn attach_turn_to_rpc_run(
        &self,
        resident: &PiResident,
        turn_id: &str,
        tx: oneshot::Sender<Result<String, String>>,
    ) {
        {
            let mut guard = resident.run.write().await;
            if guard.is_none() {
                *guard = Some(PiRpcRun::new_orphan(self.engine));
            }
            let run = guard.as_mut().expect("run just ensured");
            run.pending_turn_ids.push_back(turn_id.to_string());
            run.attached_turn_ids.push(turn_id.to_string());
            run.waiters.push((turn_id.to_string(), tx));
        }
    }

    pub(crate) async fn detach_turn_from_rpc_run(&self, resident: &PiResident, turn_id: &str) {
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
    pub(crate) async fn finish_prompt_send_resident_state(
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
                engine: self.engine,
                turn_id: Some(turn_id.to_string()),
            },
        );
    }

    /// Self-heal a single resident: run present but RPC not streaming means
    /// `agent_settled` was missed. Do not inspect other sessions' runs.
    pub(crate) async fn settle_stale_rpc_run_if_idle(&self, resident: &PiResident) {
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
    pub(crate) async fn align_rpc_session(
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
                let file = match crate::engine::pi_history::resolve_pi_family_session_file_by_id(
                    self.engine,
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
    pub(crate) async fn drop_resident_by_key(&self, key: &str) {
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
    pub(crate) async fn reconcile_rpc_model(
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
}
