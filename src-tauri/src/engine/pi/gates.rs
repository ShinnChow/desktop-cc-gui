use super::*;

pub fn resolve_pi_session_id_for_engine_send(
    continue_session: bool,
    explicit_session_id: Option<String>,
    tracked_session_id: Option<String>,
) -> Option<String> {
    continue_session
        .then(|| explicit_session_id.or(tracked_session_id))
        .flatten()
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
