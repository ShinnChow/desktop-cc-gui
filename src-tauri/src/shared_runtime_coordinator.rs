//! Shared Runtime lifecycle owner。
//!
//! V2 dispatch 在产生 Runtime side effect 前注册 durable attempt。Runtime event 先进入本
//! coordinator，再进入普通 UI fan-out / throttle。这里按 attempt owner 组装 terminal
//! snapshot；frontend 只能通过 backend durable await 等待 settlement，不能提供
//! canonical assistant content，也不能把 transient UI event 当成 control authority。

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use serde_json::Value;
#[cfg(test)]
use serde_json::json;

use crate::backend::events::AppServerEvent;
use crate::engine::events::EngineEvent;
use crate::engine::EngineType;
use crate::shared_event_log::canonical::assembler::{
    RuntimeFinalSnapshot, RuntimeToolCall, RuntimeToolResult,
};
use crate::shared_event_log::canonical::types::{
    ArtifactRef, CanonicalBlock, CanonicalOmission, OutcomeStatus, ProviderPrivateRef,
    ToolResultStatus, TurnExecutionSnapshot,
};

mod canonical_blocks;
mod identity;
mod ingress;

pub(crate) use canonical_blocks::*;
pub(crate) use identity::*;
pub(crate) use ingress::*;

const MAX_UNOWNED_EVENTS: usize = 512;
const UNCLASSIFIED_RUNTIME_FAILURE_CODE: &str = "runtime_failure_unclassified";
/// Claude CLI 的同一完整 observation 可能同时从 streaming 与 result surface 到达。
/// 只对足够长的 full observation 判重，避免吞掉正常的短 token/fragment。
const CLAUDE_FULL_OBSERVATION_MIN_CHARS: usize = 24;
#[cfg(test)]
const TEST_PROVIDER_RUNTIME_KEY: &str = "test-provider-runtime";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SharedRuntimeAttemptOwner {
    pub workspace_id: String,
    /// 实际承载本次 attempt 的 Provider-scoped Runtime identity。
    ///
    /// 同一 workspace + engine 下允许多个 Provider Runtime 并行；native
    /// session / runtime turn id 只能在该 scope 内解释。
    pub provider_runtime_key: String,
    pub shared_session_id: String,
    pub shared_thread_id: String,
    pub logical_turn_id: String,
    pub attempt_id: String,
    pub binding_key: String,
    /// Binding generation frozen by the durable `turnRequested` owner.
    pub binding_operation_id: String,
    pub engine: EngineType,
    /// `conversation.turnRequested.target` 的 durable 副本。
    ///
    /// Runtime fan-out 必须携带创建 attempt 时冻结的身份，不能在 frontend
    /// 重新读取当前 Picker 推断本轮 Provider / Model。
    pub execution_target_snapshot: TurnExecutionSnapshot,
    pub native_session_id: Option<String>,
    pub runtime_turn_id: Option<String>,
    pub context_marker: Option<SharedRuntimeContextMarker>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SharedRuntimeContextMarker {
    pub package_id: String,
    pub source_checksum: String,
}

impl SharedRuntimeContextMarker {
    fn wire_marker(&self) -> String {
        format!(
            "MOSSX_CONTEXT_PACKAGE:{}:{}",
            self.package_id, self.source_checksum
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SharedRuntimeContextAck {
    pub attempt_id: String,
    pub package_id: String,
    pub source_checksum: String,
}

#[derive(Debug, Clone)]
pub(crate) enum SharedRuntimeContextWaitOutcome {
    Acknowledged(SharedRuntimeContextAck),
    Settled(SettledSharedRuntimeAttempt),
}

#[derive(Debug, Clone)]
pub(crate) struct SettledSharedRuntimeAttempt {
    pub owner: SharedRuntimeAttemptOwner,
    pub final_snapshot: RuntimeFinalSnapshot,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SharedRuntimeObservation {
    pub owner: Option<SharedRuntimeAttemptOwner>,
    pub agent_event: Option<EngineEvent>,
    pub settled: Option<SettledSharedRuntimeAttempt>,
    /// `true` 时该 ingress 已由 Shared owner 接管并等待 replay barrier；普通
    /// Native/UI fan-out 必须跳过，durable accept 后由 drain 唯一发出。
    pub ui_fanout_deferred: bool,
    /// 区分“等待 exact owner identity”与“已绑定但等待 replay barrier”。
    pub ui_fanout_defer_reason: Option<SharedRuntimeUiFanoutDeferReason>,
    /// 当前 defer queue 深度，只用于 content-safe attribution。
    pub deferred_queue_depth: usize,
    /// coordinator 生命周期内因 unowned queue 满而丢弃的累计事件数。
    pub unowned_overflow_drop_count: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SharedRuntimeUiFanoutDeferReason {
    AwaitingOwnerIdentity,
    ReplayBarrier,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SharedRuntimeCoordinator {
    inner: Arc<Mutex<CoordinatorState>>,
}

#[derive(Debug, Default)]
struct CoordinatorState {
    attempts: HashMap<String, AttemptAccumulator>,
    attempt_by_runtime_turn: HashMap<RuntimeIdentityKey, String>,
    attempt_by_native_session: HashMap<RuntimeIdentityKey, String>,
    settled_by_attempt: HashMap<String, SettledSharedRuntimeAttempt>,
    replay_barriers: HashMap<String, ReplayBarrier>,
    held_attempt_by_native_session: HashMap<RuntimeIdentityKey, String>,
    held_provisioning_attempts_by_runtime: HashMap<RuntimeScopeKey, HashSet<String>>,
    unowned_events: VecDeque<RuntimeIngress>,
    unowned_overflow_drop_count: u64,
}

#[derive(Debug, Default)]
struct ReplayBarrier {
    pending: VecDeque<RuntimeIngress>,
    native_releases: VecDeque<AppServerEvent>,
}

#[derive(Debug, Clone)]
pub(crate) struct SharedRuntimeReplayDelivery {
    pub observation: SharedRuntimeObservation,
    pub app_server_events: Vec<AppServerEvent>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SharedRuntimeReplayBatch {
    pub deliveries: Vec<SharedRuntimeReplayDelivery>,
    pub native_app_server_events: Vec<AppServerEvent>,
    /// `true` 表示 barrier 已在 coordinator lock 内原子关闭；此后 ingress
    /// 可以直接进入正常 observation / UI fan-out。
    pub barrier_cleared: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct RuntimeIdentityKey {
    workspace_id: String,
    engine: EngineType,
    provider_runtime_key: String,
    identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct RuntimeScopeKey {
    workspace_id: String,
    engine: EngineType,
    provider_runtime_key: String,
}

#[derive(Debug)]
pub(crate) struct AttemptAccumulator {
    owner: SharedRuntimeAttemptOwner,
    assistant_blocks: Vec<CanonicalBlock>,
    tool_calls: Vec<RuntimeToolCall>,
    tool_results: Vec<RuntimeToolResult>,
    tool_output_deltas: HashMap<String, String>,
    artifacts: Vec<ArtifactRef>,
    provider_private_refs: Vec<ProviderPrivateRef>,
    omissions: Vec<CanonicalOmission>,
    context_ack: Option<SharedRuntimeContextAck>,
    context_ack_notify: Arc<tokio::sync::Notify>,
    settlement_notify: Arc<tokio::sync::Notify>,
    cancel_intent: bool,
    settled: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct RuntimeIngress {
    workspace_id: String,
    engine: EngineType,
    provider_runtime_key: String,
    runtime_turn_id: Option<String>,
    native_session_id: Option<String>,
    is_session_started: bool,
    actions: Vec<AccumulatorAction>,
    agent_event: Option<EngineEvent>,
    replay_app_server_events: Vec<AppServerEvent>,
}

#[derive(Debug, Clone)]
pub(crate) enum AccumulatorAction {
    AssistantDelta(String),
    AssistantSnapshot(String),
    ReasoningDelta(String),
    ToolStarted {
        tool_id: String,
        tool_name: String,
        input: Option<Value>,
    },
    ToolInputUpdated {
        tool_id: String,
        tool_name: Option<String>,
        input: Option<Value>,
    },
    ToolOutputDelta {
        tool_id: String,
        delta: String,
    },
    ToolCompleted {
        tool_id: String,
        tool_name: Option<String>,
        output: Option<Value>,
        error: Option<String>,
    },
    Artifacts(Vec<ArtifactRef>),
    ContextEcho(String),
    Terminal(TerminalEvidence),
}

#[derive(Debug, Clone)]
pub(crate) struct TerminalEvidence {
    outcome: OutcomeStatus,
    error_code: Option<String>,
    error_message: Option<String>,
    stop_reason: Option<String>,
    fallback_text: Option<String>,
    artifacts: Vec<ArtifactRef>,
    provider_private_refs: Vec<ProviderPrivateRef>,
    omissions: Vec<CanonicalOmission>,
}

impl AttemptAccumulator {
    fn new(owner: SharedRuntimeAttemptOwner) -> Self {
        Self {
            owner,
            assistant_blocks: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            tool_output_deltas: HashMap::new(),
            artifacts: Vec::new(),
            provider_private_refs: Vec::new(),
            omissions: Vec::new(),
            context_ack: None,
            context_ack_notify: Arc::new(tokio::sync::Notify::new()),
            settlement_notify: Arc::new(tokio::sync::Notify::new()),
            cancel_intent: false,
            settled: false,
        }
    }

    fn apply(&mut self, action: AccumulatorAction) -> Option<SettledSharedRuntimeAttempt> {
        if self.settled {
            return None;
        }
        match action {
            AccumulatorAction::AssistantDelta(text) => {
                self.merge_runtime_observation(CanonicalBlock::Text { text });
            }
            AccumulatorAction::AssistantSnapshot(text) => {
                self.merge_complete_assistant_text(text);
            }
            AccumulatorAction::ReasoningDelta(text) => {
                self.merge_runtime_observation(CanonicalBlock::Reasoning { text });
            }
            AccumulatorAction::ToolStarted {
                tool_id,
                tool_name,
                input,
            } => self.upsert_tool_call(tool_id, Some(tool_name), input),
            AccumulatorAction::ToolInputUpdated {
                tool_id,
                tool_name,
                input,
            } => self.upsert_tool_call(tool_id, tool_name, input),
            AccumulatorAction::ToolOutputDelta { tool_id, delta } => {
                self.tool_output_deltas
                    .entry(tool_id)
                    .or_default()
                    .push_str(&delta);
            }
            AccumulatorAction::ToolCompleted {
                tool_id,
                tool_name,
                output,
                error,
            } => {
                self.upsert_tool_call(tool_id.clone(), tool_name, None);
                let output_summary = output
                    .as_ref()
                    .map(stringify_json_value)
                    .filter(|text| !text.is_empty())
                    .or_else(|| self.tool_output_deltas.remove(&tool_id));
                let status = if error.is_some() {
                    ToolResultStatus::Error
                } else {
                    ToolResultStatus::Completed
                };
                upsert_tool_result(
                    &mut self.tool_results,
                    RuntimeToolResult {
                        tool_call_id: tool_id,
                        status,
                        output_summary,
                        error_message: error,
                    },
                );
                if let Some(output) = output.as_ref() {
                    extend_unique_artifacts(
                        &mut self.artifacts,
                        extract_explicit_artifact_refs(output),
                    );
                }
            }
            AccumulatorAction::Artifacts(artifacts) => {
                extend_unique_artifacts(&mut self.artifacts, artifacts);
            }
            AccumulatorAction::ContextEcho(echo) => {
                if self.context_ack.is_none() {
                    if let Some(marker) = self.owner.context_marker.as_ref() {
                        if echo.contains(&marker.wire_marker()) {
                            self.context_ack = Some(SharedRuntimeContextAck {
                                attempt_id: self.owner.attempt_id.clone(),
                                package_id: marker.package_id.clone(),
                                source_checksum: marker.source_checksum.clone(),
                            });
                            self.context_ack_notify.notify_one();
                        }
                    }
                }
            }
            AccumulatorAction::Terminal(mut evidence) => {
                // Runtime 通常把用户 interrupt 表达为 TurnError。control plane
                // 已确认发送 cancel intent 后，这类 terminal 属于 Cancelled，
                // 不能再伪装成 Provider failure。
                if self.cancel_intent && evidence.outcome == OutcomeStatus::Failed {
                    evidence.outcome = OutcomeStatus::Cancelled;
                    evidence
                        .stop_reason
                        .get_or_insert_with(|| "interrupted".to_string());
                }
                // Canonical failed outcome 强制要求 errorCode。部分 Runtime 只返回
                // status/message；在 lifecycle owner 的唯一收敛点补齐稳定 fallback，
                // 同时保留 Provider 提供的真实 code。
                if evidence.outcome == OutcomeStatus::Failed
                    && evidence
                        .error_code
                        .as_ref()
                        .is_none_or(|code| code.trim().is_empty())
                {
                    evidence.error_code = Some(UNCLASSIFIED_RUNTIME_FAILURE_CODE.to_string());
                }
                if let Some(text) = evidence
                    .fallback_text
                    .filter(|text| !text.trim().is_empty())
                {
                    self.merge_complete_assistant_text(text);
                }
                extend_unique_artifacts(&mut self.artifacts, evidence.artifacts);
                extend_unique_private_refs(
                    &mut self.provider_private_refs,
                    evidence.provider_private_refs,
                );
                extend_unique_omissions(&mut self.omissions, evidence.omissions);
                self.settled = true;
                let settled = SettledSharedRuntimeAttempt {
                    owner: self.owner.clone(),
                    final_snapshot: RuntimeFinalSnapshot {
                        assistant_blocks: std::mem::take(&mut self.assistant_blocks),
                        assistant_text: None,
                        tool_calls: std::mem::take(&mut self.tool_calls),
                        tool_results: std::mem::take(&mut self.tool_results),
                        artifacts: std::mem::take(&mut self.artifacts),
                        provider_private_refs: std::mem::take(&mut self.provider_private_refs),
                        omissions: std::mem::take(&mut self.omissions),
                        outcome: evidence.outcome,
                        error_code: evidence.error_code,
                        error_message: evidence.error_message,
                        stop_reason: evidence.stop_reason,
                    },
                };
                // 同一 Attempt 可能同时存在旧 observer 与 recovery reattachment。
                // waiter 会先注册再复查 state，因此这里安全唤醒全部 observer。
                self.settlement_notify.notify_waiters();
                return Some(settled);
            }
        }
        None
    }

    fn merge_runtime_observation(&mut self, next: CanonicalBlock) {
        if self.owner.engine == EngineType::Claude {
            merge_claude_full_observation(&mut self.assistant_blocks, next);
        } else {
            push_assistant_block(&mut self.assistant_blocks, next);
        }
    }

    fn merge_complete_assistant_text(&mut self, complete_text: String) {
        if self.owner.engine == EngineType::Claude {
            merge_claude_complete_assistant_text(&mut self.assistant_blocks, complete_text);
        } else {
            merge_complete_assistant_text(&mut self.assistant_blocks, complete_text);
        }
    }

    fn upsert_tool_call(
        &mut self,
        tool_id: String,
        tool_name: Option<String>,
        input: Option<Value>,
    ) {
        let arguments_summary = input
            .as_ref()
            .map(stringify_json_value)
            .filter(|text| !text.is_empty());
        if let Some(existing) = self
            .tool_calls
            .iter_mut()
            .find(|call| call.tool_call_id == tool_id)
        {
            if let Some(tool_name) = tool_name.filter(|name| !name.trim().is_empty()) {
                existing.tool_name = tool_name;
            }
            if let Some(incoming) = arguments_summary {
                existing.arguments_summary = Some(merge_tool_arguments_summary(
                    existing.arguments_summary.as_deref(),
                    &incoming,
                ));
            }
            return;
        }
        self.tool_calls.push(RuntimeToolCall {
            tool_call_id: tool_id.clone(),
            tool_name: tool_name
                .filter(|name| !name.trim().is_empty())
                .unwrap_or(tool_id),
            arguments_summary,
        });
    }
}

impl SharedRuntimeCoordinator {
    pub(crate) fn register_attempt(
        &self,
        mut owner: SharedRuntimeAttemptOwner,
    ) -> Result<Option<SettledSharedRuntimeAttempt>, String> {
        if owner.native_session_id.is_some() {
            owner.native_session_id = normalize_native_session_identity(
                owner.engine,
                Some(owner.provider_runtime_key.as_str()),
                owner.native_session_id.as_deref(),
            );
            if owner.native_session_id.is_none() {
                return Err("shared runtime native session identity is empty".to_string());
            }
        }
        validate_owner(&owner)?;
        let mut state = self.lock();
        if let Some(existing) = state.attempts.get(&owner.attempt_id) {
            if !same_durable_owner(&existing.owner, &owner) {
                return Err(format!(
                    "shared runtime attempt owner mismatch: {}",
                    owner.attempt_id
                ));
            }
        } else {
            state.attempts.insert(
                owner.attempt_id.clone(),
                AttemptAccumulator::new(owner.clone()),
            );
        }
        state.update_owner_identities(&owner.attempt_id, &owner)?;
        // Runtime send 尚未返回 exact identity 时不能消费 unowned events。
        // 唯一 replay handoff 在 bind_runtime_turn 中开启 barrier。
        Ok(None)
    }

    /// 绑定 exact runtime identity，并在同一 coordinator lock 内开启 replay
    /// barrier、搬运此前 unowned ingress。直到 `drain_replay_barrier` 原子清除
    /// barrier，后续同 owner 的可见 ingress 也只会排队，不会越过早到事件。
    pub(crate) fn bind_runtime_turn(
        &self,
        attempt_id: &str,
        runtime_turn_id: Option<&str>,
        native_session_id: Option<&str>,
    ) -> Result<Option<SettledSharedRuntimeAttempt>, String> {
        let mut state = self.lock();
        let owner = {
            let attempt = state
                .attempts
                .get_mut(attempt_id)
                .ok_or_else(|| format!("shared runtime attempt not registered: {attempt_id}"))?;
            if let Some(runtime_turn_id) = normalize_identity(runtime_turn_id) {
                if let Some(existing) = attempt.owner.runtime_turn_id.as_deref() {
                    if existing != runtime_turn_id {
                        return Err(format!(
                            "shared runtime turn identity mismatch for attempt {attempt_id}"
                        ));
                    }
                } else {
                    attempt.owner.runtime_turn_id = Some(runtime_turn_id.to_string());
                }
            }
            if let Some(native_session_id) = normalize_native_session_identity(
                attempt.owner.engine,
                Some(attempt.owner.provider_runtime_key.as_str()),
                native_session_id,
            ) {
                attempt.owner.native_session_id = Some(native_session_id);
            }
            attempt.owner.clone()
        };
        state.update_owner_identities(attempt_id, &owner)?;
        state.open_replay_barrier(attempt_id)?;
        Ok(None)
    }

    /// 在 actual Runtime side effect 前登记本次 attempt 将使用的 Native Binding。
    /// 这里只决定早到 UI event 的 hold，不赋予 canonical owner：带 runtimeTurnId
    /// 的 ingress 仍必须等 exact `bind_runtime_turn` 才能归属，避免复用 Binding
    /// 上一轮的迟到 terminal 被错配到新 attempt。
    pub(crate) fn hold_native_session(
        &self,
        attempt_id: &str,
        native_session_id: &str,
    ) -> Result<(), String> {
        let mut state = self.lock();
        let attempt = state
            .attempts
            .get(attempt_id)
            .ok_or_else(|| format!("shared runtime attempt not registered: {attempt_id}"))?;
        let native_session_id = normalize_native_session_identity(
            attempt.owner.engine,
            Some(attempt.owner.provider_runtime_key.as_str()),
            Some(native_session_id),
        )
        .ok_or_else(|| "shared runtime native session identity is empty".to_string())?;
        let key = RuntimeIdentityKey {
            workspace_id: attempt.owner.workspace_id.clone(),
            engine: attempt.owner.engine,
            provider_runtime_key: attempt.owner.provider_runtime_key.clone(),
            identity: native_session_id.clone(),
        };
        if let Some(existing) = state.held_attempt_by_native_session.get(&key) {
            if existing != attempt_id {
                return Err(format!(
                    "shared runtime native session hold conflict: {native_session_id}"
                ));
            }
        }
        state
            .held_attempt_by_native_session
            .insert(key, attempt_id.to_string());
        Ok(())
    }

    /// Codex `thread/start` 在 response 返回 exact thread id 前可能先发
    /// `thread/started`。仅在同 workspace/engine/provider scope 暂存该启动事件，
    /// 防止隐藏 Shared Binding 先进入普通 Session catalog。
    pub(crate) fn hold_native_provisioning(&self, attempt_id: &str) -> Result<(), String> {
        let mut state = self.lock();
        let attempt = state
            .attempts
            .get(attempt_id)
            .ok_or_else(|| format!("shared runtime attempt not registered: {attempt_id}"))?;
        if attempt.owner.engine != EngineType::Codex {
            return Err("native provisioning hold is only valid for Codex".to_string());
        }
        let scope = runtime_scope_key(&attempt.owner);
        state
            .held_provisioning_attempts_by_runtime
            .entry(scope)
            .or_default()
            .insert(attempt_id.to_string());
        Ok(())
    }

    /// exact native identity 已知后撤销 provider-scoped hold。当前 Attempt 的
    /// `thread/started` 仍由 native-session hold 保护；同 scope 的非目标启动事件
    /// 返回调用方，按原 Native 路径继续 fan-out。
    pub(crate) fn finish_native_provisioning(
        &self,
        attempt_id: &str,
    ) -> Result<Vec<AppServerEvent>, String> {
        let mut state = self.lock();
        let attempt = state
            .attempts
            .get(attempt_id)
            .ok_or_else(|| format!("shared runtime attempt not registered: {attempt_id}"))?;
        let scope = runtime_scope_key(&attempt.owner);
        state.remove_provisioning_hold(attempt_id);

        let mut remaining = VecDeque::new();
        let mut native_releases = Vec::new();
        while let Some(ingress) = state.unowned_events.pop_front() {
            let is_unheld_start_in_scope = ingress.is_session_started
                && runtime_scope_key_for_ingress(&ingress) == scope
                && !state.is_exact_native_held_ingress(&ingress)
                && !state.is_provisioning_held_ingress(&ingress);
            if is_unheld_start_in_scope {
                native_releases.extend(ingress.replay_app_server_events);
            } else {
                remaining.push_back(ingress);
            }
        }
        state.unowned_events = remaining;
        Ok(native_releases)
    }

    pub(crate) fn ingest_codex_event_scoped(
        &self,
        provider_runtime_key: &str,
        workspace_id: &str,
        event: &Value,
    ) -> SharedRuntimeObservation {
        self.ingest(normalize_codex_ingress(
            provider_runtime_key,
            workspace_id,
            event,
        ))
    }

    pub(crate) fn ingest_engine_event_scoped(
        &self,
        provider_runtime_key: &str,
        engine: EngineType,
        runtime_turn_id: Option<&str>,
        native_session_id: Option<&str>,
        event: &EngineEvent,
    ) -> SharedRuntimeObservation {
        self.ingest_engine_event_with_replay_scoped(
            provider_runtime_key,
            engine,
            runtime_turn_id,
            native_session_id,
            event,
            Vec::new(),
        )
    }

    pub(crate) fn ingest_engine_event_with_replay_scoped(
        &self,
        provider_runtime_key: &str,
        engine: EngineType,
        runtime_turn_id: Option<&str>,
        native_session_id: Option<&str>,
        event: &EngineEvent,
        replay_app_server_events: Vec<AppServerEvent>,
    ) -> SharedRuntimeObservation {
        let mut ingress = normalize_engine_ingress(
            provider_runtime_key,
            engine,
            runtime_turn_id,
            native_session_id,
            event,
        );
        ingress.replay_app_server_events = replay_app_server_events;
        self.ingest(ingress)
    }

    #[cfg(test)]
    fn ingest_codex_event(&self, workspace_id: &str, event: &Value) -> SharedRuntimeObservation {
        self.ingest_codex_event_scoped(TEST_PROVIDER_RUNTIME_KEY, workspace_id, event)
    }

    #[cfg(test)]
    fn ingest_engine_event(
        &self,
        engine: EngineType,
        runtime_turn_id: Option<&str>,
        native_session_id: Option<&str>,
        event: &EngineEvent,
    ) -> SharedRuntimeObservation {
        self.ingest_engine_event_scoped(
            TEST_PROVIDER_RUNTIME_KEY,
            engine,
            runtime_turn_id,
            native_session_id,
            event,
        )
    }

    /// 每次取出 bind barrier 当前已有的 ordered batch。非空 batch 返回后仍保持
    /// barrier；调用方必须先逐事件 publish observation + emit projected UI event，
    /// 再继续 drain。仅当一次 drain 在 lock 内观察到空队列时才原子清 barrier。
    pub(crate) fn drain_replay_barrier(
        &self,
        attempt_id: &str,
    ) -> Result<SharedRuntimeReplayBatch, String> {
        self.lock().drain_replay_barrier(attempt_id)
    }

    /// interrupt 必须先登记 attempt-owned intent，再触发 Runtime side effect，
    /// 防止同步返回的 TurnError 抢先按 Failed 结算。
    pub(crate) fn mark_cancel_intent(&self, attempt_id: &str) -> Result<(), String> {
        let mut state = self.lock();
        let attempt = state
            .attempts
            .get_mut(attempt_id)
            .ok_or_else(|| format!("shared runtime attempt not registered: {attempt_id}"))?;
        if attempt.settled {
            return Err(format!(
                "shared runtime attempt already settled: {attempt_id}"
            ));
        }
        attempt.cancel_intent = true;
        Ok(())
    }

    pub(crate) fn clear_cancel_intent(&self, attempt_id: &str) {
        if let Some(attempt) = self.lock().attempts.get_mut(attempt_id) {
            attempt.cancel_intent = false;
        }
    }

    /// 非破坏读取 canonical settlement。调用方必须只在 durable commit 成功后
    /// `remove_attempt`；commit 失败时 cache 留存，供 recovery/probe 重试。
    pub(crate) fn settled_for_attempt(
        &self,
        attempt_id: &str,
    ) -> Option<SettledSharedRuntimeAttempt> {
        self.lock().settled_by_attempt.get(attempt_id).cloned()
    }

    pub(crate) fn owns_attempt(&self, attempt_id: &str) -> bool {
        self.lock().attempts.contains_key(attempt_id)
    }

    pub(crate) fn owner_for_attempt(&self, attempt_id: &str) -> Option<SharedRuntimeAttemptOwner> {
        self.lock()
            .attempts
            .get(attempt_id)
            .map(|attempt| attempt.owner.clone())
    }

    /// 等待 exact Attempt 的 authoritative Runtime settlement。
    ///
    /// 返回 `None` 表示 coordinator owner 已被其他 critical sink 清理；调用方必须
    /// 立即复查 durable `conversation.turnCommitted`，不能把 owner removal 当失败。
    pub(crate) async fn wait_for_settlement(
        &self,
        attempt_id: &str,
    ) -> Option<SettledSharedRuntimeAttempt> {
        loop {
            let notify = {
                let state = self.lock();
                if let Some(settled) = state.settled_by_attempt.get(attempt_id) {
                    return Some(settled.clone());
                }
                let Some(attempt) = state.attempts.get(attempt_id) else {
                    return None;
                };
                Arc::clone(&attempt.settlement_notify)
            };
            let notified = notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                // 注册 waiter 后复查，封闭「首次检查 → notified().await」之间的
                // terminal/remove race；同时允许 notify_waiters 唤醒所有重挂 observer。
                let state = self.lock();
                if let Some(settled) = state.settled_by_attempt.get(attempt_id) {
                    return Some(settled.clone());
                }
                if !state.attempts.contains_key(attempt_id) {
                    return None;
                }
            }
            notified.await;
        }
    }

    pub(crate) async fn wait_for_context_ack(
        &self,
        attempt_id: &str,
        timeout: std::time::Duration,
    ) -> Result<SharedRuntimeContextAck, String> {
        match self
            .wait_for_context_ack_or_settlement(attempt_id, timeout)
            .await?
        {
            SharedRuntimeContextWaitOutcome::Acknowledged(ack) => Ok(ack),
            SharedRuntimeContextWaitOutcome::Settled(_) => Err(format!(
                "shared runtime attempt settled before context ACK: {attempt_id}"
            )),
        }
    }

    pub(crate) async fn wait_for_context_ack_or_settlement(
        &self,
        attempt_id: &str,
        timeout: std::time::Duration,
    ) -> Result<SharedRuntimeContextWaitOutcome, String> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let notify = {
                let mut state = self.lock();
                let attempt = state.attempts.get(attempt_id).ok_or_else(|| {
                    format!("shared runtime attempt not registered: {attempt_id}")
                })?;
                if let Some(ack) = attempt.context_ack.as_ref() {
                    return Ok(SharedRuntimeContextWaitOutcome::Acknowledged(ack.clone()));
                }
                if state.replay_barrier_has_terminal(attempt_id) {
                    // Terminal before Context ACK is authoritative. Apply the entire
                    // held ingress queue in order, but do not expose its UI events:
                    // caller commits canonical terminal and returns the typed error.
                    loop {
                        let batch = state.drain_replay_barrier(attempt_id)?;
                        if batch.barrier_cleared {
                            break;
                        }
                    }
                    let settled = state
                        .settled_by_attempt
                        .get(attempt_id)
                        .cloned()
                        .ok_or_else(|| {
                            format!(
                                "shared runtime terminal barrier did not settle attempt {attempt_id}"
                            )
                        })?;
                    return Ok(SharedRuntimeContextWaitOutcome::Settled(settled));
                }
                Arc::clone(
                    &state
                        .attempts
                        .get(attempt_id)
                        .expect("attempt checked above")
                        .context_ack_notify,
                )
            };
            tokio::time::timeout_at(deadline, notify.notified())
                .await
                .map_err(|_| {
                    format!(
                        "ambiguous-runtime: timed out waiting for Claude context echo ACK for attempt {attempt_id}"
                    )
                })?;
        }
    }

    pub(crate) fn take_context_ack(&self, attempt_id: &str) -> Option<SharedRuntimeContextAck> {
        self.lock()
            .attempts
            .get_mut(attempt_id)
            .and_then(|attempt| attempt.context_ack.take())
    }

    pub(crate) fn remove_attempt(&self, attempt_id: &str) {
        let mut state = self.lock();
        if let Some(attempt) = state.attempts.get(attempt_id) {
            // critical sink 可能先 commit SQL 再清理 coordinator。唤醒 backend
            // waiter，让它从 durable fact 完成收敛。
            attempt.settlement_notify.notify_waiters();
        }
        let removed_scope = state
            .attempts
            .get(attempt_id)
            .map(|attempt| runtime_scope_key(&attempt.owner));
        let removed_native_keys = state
            .held_attempt_by_native_session
            .iter()
            .filter_map(|(key, mapped_attempt_id)| {
                (mapped_attempt_id == attempt_id).then_some(key.clone())
            })
            .collect::<HashSet<_>>();
        state.attempts.remove(attempt_id);
        state.settled_by_attempt.remove(attempt_id);
        state.replay_barriers.remove(attempt_id);
        state
            .held_attempt_by_native_session
            .retain(|_, mapped_attempt_id| mapped_attempt_id != attempt_id);
        state
            .attempt_by_runtime_turn
            .retain(|_, mapped_attempt_id| mapped_attempt_id != attempt_id);
        state
            .attempt_by_native_session
            .retain(|_, mapped_attempt_id| mapped_attempt_id != attempt_id);
        state.remove_provisioning_hold(attempt_id);
        let remaining_provisioning_scopes = state
            .held_provisioning_attempts_by_runtime
            .keys()
            .cloned()
            .collect::<HashSet<_>>();
        state.unowned_events.retain(|ingress| {
            let removed_exact_event = native_identity_key_for_ingress(ingress)
                .is_some_and(|key| removed_native_keys.contains(&key));
            let removed_orphan_start = ingress.is_session_started
                && removed_scope.as_ref().is_some_and(|scope| {
                    runtime_scope_key_for_ingress(ingress) == scope.clone()
                        && !remaining_provisioning_scopes.contains(scope)
                });
            !removed_exact_event && !removed_orphan_start
        });
    }

    fn ingest(&self, ingress: RuntimeIngress) -> SharedRuntimeObservation {
        let mut state = self.lock();
        state.ingest_or_buffer(ingress)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, CoordinatorState> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl CoordinatorState {
    fn remove_provisioning_hold(&mut self, attempt_id: &str) {
        self.held_provisioning_attempts_by_runtime
            .retain(|_, attempt_ids| {
                attempt_ids.remove(attempt_id);
                !attempt_ids.is_empty()
            });
    }

    fn update_owner_identities(
        &mut self,
        attempt_id: &str,
        owner: &SharedRuntimeAttemptOwner,
    ) -> Result<(), String> {
        if let Some(runtime_turn_id) = owner.runtime_turn_id.as_deref() {
            insert_identity_owner(
                &mut self.attempt_by_runtime_turn,
                identity_key(owner, runtime_turn_id),
                attempt_id,
            )?;
        }
        if let Some(native_session_id) = owner.native_session_id.as_deref() {
            // Native Binding is reused sequentially. The latest active attempt owns
            // fallback routing; exact runtime identity still wins for older events.
            self.attempt_by_native_session.insert(
                identity_key(owner, native_session_id),
                attempt_id.to_string(),
            );
        }
        Ok(())
    }

    fn ingest_or_buffer(&mut self, ingress: RuntimeIngress) -> SharedRuntimeObservation {
        let Some(attempt_id) = self.resolve_attempt_id(&ingress) else {
            if !self.is_held_shared_ingress(&ingress) {
                return SharedRuntimeObservation::default();
            }
            let first_deferred_event = self.unowned_events.is_empty();
            let overflowed = self.unowned_events.len() >= MAX_UNOWNED_EVENTS;
            if overflowed {
                self.unowned_events.pop_front();
                self.unowned_overflow_drop_count =
                    self.unowned_overflow_drop_count.saturating_add(1);
            }
            let observation = SharedRuntimeObservation {
                ui_fanout_deferred: true,
                ui_fanout_defer_reason: Some(
                    SharedRuntimeUiFanoutDeferReason::AwaitingOwnerIdentity,
                ),
                deferred_queue_depth: self.unowned_events.len() + 1,
                unowned_overflow_drop_count: self.unowned_overflow_drop_count,
                ..SharedRuntimeObservation::default()
            };
            if first_deferred_event {
                log::debug!(
                    "[shared-runtime] UI fan-out deferred reason={:?} workspace_id={} engine={:?} provider_runtime_key={} queue_depth={}",
                    observation.ui_fanout_defer_reason,
                    ingress.workspace_id,
                    ingress.engine,
                    ingress.provider_runtime_key,
                    observation.deferred_queue_depth
                );
            }
            if overflowed
                && (observation.unowned_overflow_drop_count == 1
                    || observation.unowned_overflow_drop_count.is_power_of_two())
            {
                log::warn!(
                    "[shared-runtime] unowned ingress overflow workspace_id={} engine={:?} provider_runtime_key={} queue_depth={} queue_limit={} dropped_total={}",
                    ingress.workspace_id,
                    ingress.engine,
                    ingress.provider_runtime_key,
                    observation.deferred_queue_depth,
                    MAX_UNOWNED_EVENTS,
                    observation.unowned_overflow_drop_count
                );
            }
            self.unowned_events.push_back(ingress);
            return observation;
        };
        if self.replay_barriers.contains_key(&attempt_id) {
            self.queue_behind_replay_barrier(&attempt_id, ingress);
            return SharedRuntimeObservation {
                ui_fanout_deferred: true,
                ui_fanout_defer_reason: Some(SharedRuntimeUiFanoutDeferReason::ReplayBarrier),
                deferred_queue_depth: self
                    .replay_barriers
                    .get(&attempt_id)
                    .map_or(0, |barrier| barrier.pending.len()),
                unowned_overflow_drop_count: self.unowned_overflow_drop_count,
                ..SharedRuntimeObservation::default()
            };
        }
        self.apply_ingress(&attempt_id, ingress)
    }

    fn is_exact_native_held_ingress(&self, ingress: &RuntimeIngress) -> bool {
        let Some(key) = native_identity_key_for_ingress(ingress) else {
            return false;
        };
        self.held_attempt_by_native_session
            .get(&key)
            .is_some_and(|attempt_id| self.attempts.contains_key(attempt_id))
    }

    fn is_provisioning_held_ingress(&self, ingress: &RuntimeIngress) -> bool {
        ingress.is_session_started
            && self
                .held_provisioning_attempts_by_runtime
                .get(&runtime_scope_key_for_ingress(ingress))
                .is_some_and(|attempt_ids| {
                    attempt_ids
                        .iter()
                        .any(|attempt_id| self.attempts.contains_key(attempt_id))
                })
    }

    fn is_held_shared_ingress(&self, ingress: &RuntimeIngress) -> bool {
        self.is_exact_native_held_ingress(ingress) || self.is_provisioning_held_ingress(ingress)
    }

    fn resolve_attempt_id(&self, ingress: &RuntimeIngress) -> Option<String> {
        if let Some(runtime_turn_id) = ingress.runtime_turn_id.as_deref() {
            let key = RuntimeIdentityKey {
                workspace_id: ingress.workspace_id.clone(),
                engine: ingress.engine,
                provider_runtime_key: ingress.provider_runtime_key.clone(),
                identity: runtime_turn_id.to_string(),
            };
            if let Some(attempt_id) = self.attempt_by_runtime_turn.get(&key) {
                return Some(attempt_id.clone());
            }
        }

        let native_session_id = ingress.native_session_id.as_deref()?;
        let native_key = RuntimeIdentityKey {
            workspace_id: ingress.workspace_id.clone(),
            engine: ingress.engine,
            provider_runtime_key: ingress.provider_runtime_key.clone(),
            identity: native_session_id.to_string(),
        };
        let attempt_id = self.attempt_by_native_session.get(&native_key)?;
        let attempt = self.attempts.get(attempt_id)?;
        // D8：双方都有 runtimeTurnId 时只能 exact match。Thread/native fallback 只在
        // 任一侧缺 runtime identity 时启用。
        if ingress.runtime_turn_id.is_some() && attempt.owner.runtime_turn_id.is_some() {
            return None;
        }
        Some(attempt_id.clone())
    }

    fn apply_ingress(
        &mut self,
        attempt_id: &str,
        ingress: RuntimeIngress,
    ) -> SharedRuntimeObservation {
        let owner = {
            let attempt = match self.attempts.get_mut(attempt_id) {
                Some(attempt) => attempt,
                None => return SharedRuntimeObservation::default(),
            };
            if attempt.owner.runtime_turn_id.is_none() {
                attempt.owner.runtime_turn_id = ingress.runtime_turn_id.clone();
            }
            if let Some(native_session_id) = ingress.native_session_id.as_deref() {
                attempt.owner.native_session_id = Some(native_session_id.to_string());
            }
            attempt.owner.clone()
        };
        let _ = self.update_owner_identities(attempt_id, &owner);

        let mut settled = None;
        if let Some(attempt) = self.attempts.get_mut(attempt_id) {
            for action in ingress.actions {
                if let Some(completed) = attempt.apply(action) {
                    settled = Some(completed);
                    break;
                }
            }
        }
        if let Some(completed) = settled.as_ref() {
            self.settled_by_attempt
                .entry(attempt_id.to_string())
                .or_insert_with(|| completed.clone());
        }
        SharedRuntimeObservation {
            owner: Some(owner),
            agent_event: ingress.agent_event,
            settled,
            ui_fanout_deferred: false,
            ui_fanout_defer_reason: None,
            deferred_queue_depth: 0,
            unowned_overflow_drop_count: self.unowned_overflow_drop_count,
        }
    }

    fn open_replay_barrier(&mut self, attempt_id: &str) -> Result<(), String> {
        if !self.attempts.contains_key(attempt_id) {
            return Err(format!(
                "shared runtime attempt not registered: {attempt_id}"
            ));
        }
        self.replay_barriers
            .entry(attempt_id.to_string())
            .or_default();
        self.remove_provisioning_hold(attempt_id);

        let mut remaining = VecDeque::new();
        let mut owned = VecDeque::new();
        let mut native_releases = VecDeque::new();
        while let Some(ingress) = self.unowned_events.pop_front() {
            match self.resolve_attempt_id(&ingress) {
                Some(ref resolved_attempt_id) if resolved_attempt_id == attempt_id => {
                    owned.push_back(ingress);
                }
                _ if self.is_provisioning_held_ingress(&ingress) => {
                    remaining.push_back(ingress);
                }
                _ if self.is_exact_native_held_ingress(&ingress) || ingress.is_session_started => {
                    native_releases.extend(ingress.replay_app_server_events);
                }
                _ => remaining.push_back(ingress),
            }
        }
        self.unowned_events = remaining;
        if let Some(barrier) = self.replay_barriers.get_mut(attempt_id) {
            barrier.native_releases.extend(native_releases);
        }
        for ingress in owned {
            self.queue_behind_replay_barrier(attempt_id, ingress);
        }
        self.held_attempt_by_native_session
            .retain(|_, mapped_attempt_id| mapped_attempt_id != attempt_id);
        Ok(())
    }

    fn queue_behind_replay_barrier(&mut self, attempt_id: &str, mut ingress: RuntimeIngress) {
        // Claude replay echo 是 transport ACK。durable accept 会等待它，因此不能
        // 被可见事件 barrier 阻塞；只把剩余可见 actions 保持原顺序排队。
        let mut deferred_actions = Vec::with_capacity(ingress.actions.len());
        let mut terminal_deferred = false;
        if let Some(attempt) = self.attempts.get_mut(attempt_id) {
            for action in ingress.actions.drain(..) {
                match action {
                    AccumulatorAction::ContextEcho(_) => {
                        let _ = attempt.apply(action);
                    }
                    _ => {
                        terminal_deferred |= matches!(&action, AccumulatorAction::Terminal(_));
                        deferred_actions.push(action);
                    }
                }
            }
            if terminal_deferred {
                attempt.context_ack_notify.notify_one();
            }
        }
        ingress.actions = deferred_actions;
        if ingress.actions.is_empty()
            && ingress.agent_event.is_none()
            && ingress.replay_app_server_events.is_empty()
        {
            return;
        }
        if let Some(barrier) = self.replay_barriers.get_mut(attempt_id) {
            let first_deferred_event = barrier.pending.is_empty();
            barrier.pending.push_back(ingress);
            if first_deferred_event {
                log::debug!(
                    "[shared-runtime] UI fan-out deferred reason=replay-barrier attempt_id={} queue_depth=1",
                    attempt_id
                );
            }
        }
    }

    fn replay_barrier_has_terminal(&self, attempt_id: &str) -> bool {
        self.replay_barriers.get(attempt_id).is_some_and(|barrier| {
            barrier.pending.iter().any(|ingress| {
                ingress
                    .actions
                    .iter()
                    .any(|action| matches!(action, AccumulatorAction::Terminal(_)))
            })
        })
    }

    fn drain_replay_barrier(
        &mut self,
        attempt_id: &str,
    ) -> Result<SharedRuntimeReplayBatch, String> {
        let (pending, native_app_server_events) = {
            let Some(barrier) = self.replay_barriers.get_mut(attempt_id) else {
                return Ok(SharedRuntimeReplayBatch {
                    deliveries: Vec::new(),
                    native_app_server_events: Vec::new(),
                    barrier_cleared: true,
                });
            };
            if barrier.pending.is_empty() && barrier.native_releases.is_empty() {
                self.replay_barriers.remove(attempt_id);
                return Ok(SharedRuntimeReplayBatch {
                    deliveries: Vec::new(),
                    native_app_server_events: Vec::new(),
                    barrier_cleared: true,
                });
            }
            (
                std::mem::take(&mut barrier.pending),
                std::mem::take(&mut barrier.native_releases)
                    .into_iter()
                    .collect::<Vec<_>>(),
            )
        };

        let mut deliveries = Vec::with_capacity(pending.len());
        for ingress in pending {
            let is_duplicate_terminal = self.settled_by_attempt.contains_key(attempt_id)
                && ingress
                    .actions
                    .iter()
                    .any(|action| matches!(action, AccumulatorAction::Terminal(_)));
            if is_duplicate_terminal {
                continue;
            }
            let mut app_server_events = ingress.replay_app_server_events.clone();
            let observation = self.apply_ingress(attempt_id, ingress);
            let Some(owner) = observation.owner.as_ref() else {
                continue;
            };
            for event in &mut app_server_events {
                project_app_server_event_to_shared_owner(event, owner);
            }
            deliveries.push(SharedRuntimeReplayDelivery {
                observation,
                app_server_events,
            });
        }

        Ok(SharedRuntimeReplayBatch {
            deliveries,
            native_app_server_events,
            // 非空 batch 必须先由调用方完成 publish + emit；此处保持 barrier，
            // 让期间到达的 ingress 继续排队。下一轮空 drain 才原子清除。
            barrier_cleared: false,
        })
    }
}


#[cfg(test)]
#[path = "coordinator_tests.rs"]
mod tests;
