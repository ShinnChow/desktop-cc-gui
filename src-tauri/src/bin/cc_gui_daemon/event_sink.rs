use tauri::AppHandle;

use crate::backend::events::{AppServerEvent, EventSink, TerminalOutput};

#[derive(Clone)]
pub(crate) struct NoopEventSink;

impl EventSink for NoopEventSink {
    fn emit_app_server_event(&self, _event: AppServerEvent) {}

    fn emit_terminal_output(&self, _event: TerminalOutput) {}
}

pub(crate) fn build_event_sink(_app: AppHandle) -> NoopEventSink {
    NoopEventSink
}

