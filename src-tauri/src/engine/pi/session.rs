use super::*;

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
    /// pi 族引擎身份（Pi | Omp）：事件标签 / bin 解析 / 前缀判定全走此字段
    /// （add-omp-engine；omp 与 pi 共享本实现）。
    pub(crate) engine: EngineType,
    pub(crate) session_id: RwLock<Option<String>>,
    pub(crate) event_sender: broadcast::Sender<PiTurnEvent>,
    pub(crate) bin_path: Option<String>,
    pub(crate) home_dir: Option<String>,
    pub(crate) custom_args: Option<String>,
    pub(crate) active_processes: Mutex<HashMap<String, ActivePiChildProcess>>,
    pub(crate) interrupted_turns: Mutex<HashSet<String>>,
    /// One RPC resident per PI session (and one scratch slot per new-send).
    /// Parallel native PI threads MUST NOT share a process — a single
    /// workspace-wide client serializes all tabs behind `switch_session`.
    pub(crate) residents: Arc<RwLock<HashMap<String, PiResident>>>,
    /// Sticky latch: handshake proved this binary cannot speak RPC.
    /// Per-session spawn failures do not set this; only `PiRpcClient::spawn`
    /// handshake errors do (old pi without `--mode rpc`). 记录置位时间：闩只
    /// 拦新 spawn（存活 resident 复用优先），冷却期过后放行一次试探
    /// spawn，成功即清闩自愈——禁止 app 生命周期内不可逆（用户实证：一次
    /// 切模型失败把全 workspace 的 RPC + 会话树打残到重启）。
    pub(crate) rpc_disabled_since: Arc<Mutex<Option<Instant>>>,
}

impl PiSession {
    pub fn new(
        engine: EngineType,
        workspace_id: String,
        workspace_path: PathBuf,
        config: Option<EngineConfig>,
    ) -> Self {
        debug_assert!(engine.is_pi_family(), "PiSession requires a pi-family engine");
        let (event_sender, _) = broadcast::channel(8192);
        let config = config.unwrap_or_default();
        Self {
            workspace_id,
            workspace_path,
            engine,
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

    pub(crate) async fn set_session_id(&self, id: Option<String>) {
        *self.session_id.write().await = id;
    }

    pub(crate) fn emit_turn_event(&self, turn_id: &str, event: EngineEvent) {
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

    pub(crate) fn resolve_bin_path(&self) -> String {
        let bin_name = self
            .engine
            .pi_family_spec()
            .map(|spec| spec.bin_name)
            .unwrap_or("pi");
        if let Some(custom) = &self.bin_path {
            custom.clone()
        } else {
            crate::backend::app_server::find_cli_binary(bin_name, None)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| bin_name.to_string())
        }
    }

    // ===== RPC resident path (`pi --mode rpc`) =====
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
