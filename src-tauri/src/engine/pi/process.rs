use super::*;

#[allow(dead_code)]
pub struct PiActiveProcessSnapshot {
    pub pid: u32,
    pub registered_age_ms: u64,
}

pub(crate) struct ActivePiChildProcess {
    pub(crate) child: Child,
    /// 该 print-json 进程绑定的 PI session id（None = 新会话，spawn 出全新
    /// session JSONL）。fallback 忙互斥按它过滤：只有同一 session 的并发
    /// print-json 才会交叉写同一 JSONL；新会话 / 不同 session MUST 并行。
    pub(crate) session_id: Option<String>,
    #[allow(dead_code)]
    started_at_ms: u64,
}

impl ActivePiChildProcess {
    pub(crate) fn new(child: Child, session_id: Option<String>) -> Self {
        Self {
            child,
            session_id,
            started_at_ms: unix_timestamp_ms_for_process_diagnostics(),
        }
    }

    pub(crate) fn into_child(self) -> Child {
        self.child
    }

    #[allow(dead_code)]
    pub(crate) fn snapshot(&self, sampled_at_ms: u64) -> Option<PiActiveProcessSnapshot> {
        Some(PiActiveProcessSnapshot {
            pid: self.child.id()?,
            registered_age_ms: sampled_at_ms.saturating_sub(self.started_at_ms),
        })
    }
}

pub(crate) fn apply_interrupt_result(
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
pub(crate) fn print_json_fallback_busy<'a>(
    mut active_sessions: impl Iterator<Item = Option<&'a str>>,
    session_id: Option<&str>,
) -> bool {
    let Some(session_id) = session_id else {
        return false;
    };
    active_sessions.any(|active| active == Some(session_id))
}

pub(crate) fn unix_timestamp_ms_for_process_diagnostics() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
