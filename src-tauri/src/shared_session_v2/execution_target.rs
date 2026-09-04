use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::engine::EngineType;
use crate::shared_context::RuntimeContextCapabilities;
use crate::shared_event_log::canonical::types::{
    CanonicalProviderProfileSource,
    ReasoningSelection,
    TurnExecutionSnapshot,
};
use crate::shared_sessions::ensure_supported_shared_session_engine;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// 输入类型
// ---------------------------------------------------------------------------

/// 前端四级 Picker 固化的 Execution Target（含 provider 元信息快照）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionTargetInput {
    pub engine: EngineType,
    pub provider_profile_id: Option<String>,
    #[serde(default)]
    pub model_catalog_entry_id: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub provider_profile_name_snapshot: Option<String>,
    pub provider_profile_source: Option<CanonicalProviderProfileSource>,
    pub runtime_capability_fingerprint: Option<String>,
}

pub(crate) fn context_capabilities(target: &ExecutionTargetInput) -> RuntimeContextCapabilities {
    // Adapter capability 在这里显式声明；compiler 只消费 capability，不按 engine 分支。
    // 当前 runtime bridge 对五种 Shared CLI 都有 user-channel prompt ACK，
    // structured import 等待对应 CLI method probe 后再打开，禁止猜测支持。
    match target.engine {
        EngineType::Codex => RuntimeContextCapabilities {
            // `thread/inject_items` only proves that the app-server exposes a method.
            // Third-party providers may still reject a reconstructed message/tool chain
            // whose provider-private reasoning item is unavailable. Shared must keep the
            // portable semantic transcript boundary until a protocol-safe probe exists.
            native_delta: false,
            structured_history_import: false,
            native_clone: false,
            user_channel_transcript: true,
            tool_history: false,
            image_history: false,
            strong_context_ack: false,
        },
        EngineType::Claude => RuntimeContextCapabilities {
            native_delta: false,
            structured_history_import: false,
            native_clone: false,
            user_channel_transcript: true,
            tool_history: false,
            image_history: false,
            // Shared Claude runtime 强制启用 `--replay-user-messages`，因此 prompt-prefix
            // delivery 必须等到 coordinator 观察到精确 checksum echo，不能把 send
            // response 当作 context acceptance。fingerprint 只用于审计，不参与降级。
            strong_context_ack: true,
        },
        EngineType::Kimi
        | EngineType::Grok
        | EngineType::OpenCode
        | EngineType::Pi
        | EngineType::Qoder => {
            // Qoder（2026-08-22 黄金 turn 实测，spike §13/§14）：user-channel prompt
            // prefix 投递，inputAck "first-event" 弱语义；structured import 待 ACP
            // method probe，禁止猜测打开。
            RuntimeContextCapabilities {
                native_delta: false,
                structured_history_import: false,
                native_clone: false,
                user_channel_transcript: true,
                tool_history: false,
                image_history: false,
                strong_context_ack: false,
            }
        }
        _ => RuntimeContextCapabilities {
            native_delta: false,
            structured_history_import: false,
            native_clone: false,
            user_channel_transcript: false,
            tool_history: false,
            image_history: false,
            strong_context_ack: false,
        },
    }
}

pub(crate) fn raw_claude_session_id(value: &str) -> Option<&str> {
    let raw = value.strip_prefix("claude:").unwrap_or(value).trim();
    (!raw.is_empty()).then_some(raw)
}

pub(crate) fn raw_engine_session_id(engine: EngineType, value: &str) -> Option<&str> {
    let prefix = format!("{}:", engine.icon());
    let raw = value.strip_prefix(prefix.as_str()).unwrap_or(value).trim();
    (!raw.is_empty()).then_some(raw)
}

pub(crate) fn raw_qoder_session_id(
    value: &str,
    provider_profile_id: Option<&str>,
) -> Result<Option<String>, String> {
    if crate::shared_sessions::is_pending_shared_binding_thread_id(EngineType::Qoder, value) {
        return Ok(None);
    }
    Ok(Some(
        crate::engine::qoder_provider_profile::parse_qoder_native_session_identity(
            value,
            provider_profile_id,
        )?
        .raw_session_id,
    ))
}

pub(crate) fn codex_import_items(package: &crate::shared_context::ContextPackage) -> Vec<Value> {
    codex_import_projection(package).0
}

/// OpenAI / Responses / 多数三方兼容 API 只接受这些 message.role。
/// Codex 本地 rollout 经 native-history 归一后会有 `control`（session meta / 未知 type），
/// 若原样 inject 进目标 thread，续接到 DeepSeek 等会在下次 turn 反序列化失败：
/// `unknown variant control, expected one of user, assistant, system, developer`.
fn is_portable_codex_message_role(role: &str) -> bool {
    matches!(
        role.trim().to_ascii_lowercase().as_str(),
        "user" | "assistant" | "system" | "developer"
    )
}

pub(crate) fn codex_import_projection(
    package: &crate::shared_context::ContextPackage,
) -> (Vec<Value>, usize) {
    let mut dropped_entries = 0;
    let mut items: Vec<Value> = package
        .delta
        .iter()
        .flat_map(|entry| {
            let text = entry
                .blocks
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n");
            let mut items = Vec::new();
            let role = entry.role.trim().to_ascii_lowercase();
            if !text.trim().is_empty() && is_portable_codex_message_role(&role) {
                let content_type = if role == "assistant" {
                    "output_text"
                } else {
                    "input_text"
                };
                items.push(json!({
                    "type": "message",
                    "role": role,
                    "content": [{ "type": content_type, "text": text }],
                }));
            }
            for block in &entry.blocks {
                if block.get("kind").and_then(Value::as_str) == Some("atomic-tool-exchange") {
                    let exchange = &block["exchange"];
                    if let (Some(name), Some(call_id)) = (
                        exchange.get("toolName").and_then(Value::as_str),
                        exchange.get("toolCallId").and_then(Value::as_str),
                    ) {
                        items.push(json!({
                            "type": "function_call",
                            "name": name,
                            "arguments": exchange.pointer("/call/argumentsSummary").and_then(Value::as_str).unwrap_or("{}"),
                            "call_id": call_id,
                        }));
                        items.push(json!({
                            "type": "function_call_output",
                            "call_id": call_id,
                            "output": exchange.pointer("/result/outputSummary").and_then(Value::as_str).unwrap_or(""),
                        }));
                    }
                }
                if block.get("kind").and_then(Value::as_str) == Some("native-block") {
                    let value = &block["value"];
                    if matches!(
                        value.get("type").and_then(Value::as_str),
                        Some("function_call" | "function_call_output")
                    ) {
                        items.push(value.clone());
                    }
                }
            }
            if items.is_empty() {
                dropped_entries += 1;
            }
            items
        })
        .collect();
    if !items.is_empty() {
        let package_marker = format!(
            "MOSSX_CONTEXT_PACKAGE:{}:{}",
            package.package_id, package.manifest.source_checksum
        );
        let accepted_marker = format!(
            "MOSSX_CONTEXT_ACCEPTED:{}:{}",
            package.package_id, package.manifest.source_checksum
        );
        items.insert(
            0,
            json!({
                "type": "message",
                "role": "user",
                "content": [{ "type": "input_text", "text": package_marker }],
            }),
        );
        items.push(json!({
            "type": "message",
            "role": "user",
            "content": [{ "type": "input_text", "text": accepted_marker }],
        }));
    }
    (items, dropped_entries)
}

pub(crate) fn context_artifact_root(state: &AppState) -> Result<&std::path::Path, String> {
    state
        .storage_path
        .parent()
        .ok_or_else(|| "app data directory unavailable".to_string())
}

impl ExecutionTargetInput {
    pub(crate) fn normalized_provider(&self) -> Option<String> {
        self.provider_profile_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    pub(crate) fn to_snapshot(&self) -> TurnExecutionSnapshot {
        TurnExecutionSnapshot {
            engine: self.engine.icon().to_string(),
            provider_profile_id: self.normalized_provider(),
            model_catalog_entry_id: self
                .model_catalog_entry_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            model: self
                .model
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            reasoning: self
                .reasoning_effort
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|effort| ReasoningSelection {
                    effort: effort.to_string(),
                    extra: Value::Object(Default::default()),
                }),
            provider_profile_name_snapshot: self.provider_profile_name_snapshot.clone(),
            provider_profile_source: self.provider_profile_source.clone(),
            runtime_capability_fingerprint: self.runtime_capability_fingerprint.clone(),
            extra: Value::Object(Default::default()),
        }
    }
}

pub(crate) fn collaboration_mode_for_attempt(
    collaboration_mode: Option<Value>,
    target: &ExecutionTargetInput,
) -> Option<Value> {
    collaboration_mode.map(|payload| {
        let mut root = payload.as_object().cloned().unwrap_or_default();
        let mut settings = root
            .get("settings")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        match target
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(model) => {
                settings.insert("model".to_string(), Value::String(model.to_string()));
            }
            None => {
                settings.remove("model");
            }
        }
        settings.remove("reasoningEffort");
        match target
            .reasoning_effort
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(effort) => {
                settings.insert(
                    "reasoning_effort".to_string(),
                    Value::String(effort.to_string()),
                );
            }
            None => {
                settings.remove("reasoning_effort");
            }
        }

        root.insert("settings".to_string(), Value::Object(settings));
        Value::Object(root)
    })
}

fn validate_execution_target(target: &ExecutionTargetInput) -> Result<EngineType, String> {
    let engine = ensure_supported_shared_session_engine(target.engine)?;
    let provider_profile_id = target.normalized_provider();
    let models = match provider_profile_id.as_deref() {
        Some(provider_profile_id) => crate::engine::status::get_provider_scoped_engine_models(
            engine,
            Some(provider_profile_id),
        )?,
        None => crate::engine::status::get_local_engine_models_for_validation(engine),
    };
    // Qoder 模型目录是 ACP runtime-only（无静态 fallback roster），发送路径
    // 禁止现场 probe（Session Switch Catalog Fetch Gate）：catalog 不可得时按空
    // 目录 + Allow 策略放行，catalog 可用时仍交叉校验 entry/model pair。
    let models = match (engine, models) {
        (EngineType::Qoder, None) => Vec::new(),
        (_, Some(models)) => models,
        (_, None) => {
            return Err(format!(
                "invalid-target-model: model catalog is unavailable for {} provider {}",
                engine.icon(),
                provider_profile_id.as_deref().unwrap_or("default")
            ));
        }
    };
    // 与 selection 持久化一致：不因 catalog 未登记而拒绝用户自定义模型名。
    crate::engine::status::validate_model_catalog_pair(
        target.model_catalog_entry_id.as_deref(),
        target.model.as_deref(),
        &models,
        crate::engine::status::UnlistedRuntimeModelPolicy::Allow,
    )?;
    Ok(engine)
}

/// Qoder 的 provider profile 是 distribution identity，不接受普通 provider id。
/// 入口层与 Tx1 core 都调用它，避免未来新增 caller 绕过入口校验后写入错误 Binding。
pub(crate) fn validate_qoder_distribution_identity(
    engine: EngineType,
    provider_profile_id: Option<&str>,
) -> Result<(), String> {
    if engine != EngineType::Qoder {
        return Ok(());
    }
    crate::engine::qoder_provider_profile::qoder_distribution_from_provider_profile_id(
        provider_profile_id,
    )
    .map(|_| ())
    .map_err(|error| format!("invalid-target: {error}"))
}

pub(crate) fn validate_resolved_execution_target(
    target: &ExecutionTargetInput,
) -> Result<EngineType, String> {
    let provider_profile_id = target.normalized_provider();
    let expected_source = if provider_profile_id.is_some() {
        CanonicalProviderProfileSource::Managed
    } else {
        CanonicalProviderProfileSource::Local
    };
    if target.provider_profile_source != Some(expected_source) {
        return Err(format!(
            "invalid-target: providerProfileSource must be '{}'",
            match expected_source {
                CanonicalProviderProfileSource::Local => "local",
                CanonicalProviderProfileSource::Managed => "managed",
            }
        ));
    }
    // Qoder 的 providerProfileId 实际是不可变的 distribution identity，而不是
    // 普通 managed provider。必须在 Tx1 写入 turnRequested 前 fail-closed；否则
    // 非法 profile 会到 runtime 才报错，留下无法执行的 durable attempt。
    validate_qoder_distribution_identity(target.engine, provider_profile_id.as_deref())?;
    if target
        .provider_profile_name_snapshot
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        return Err("invalid-target: providerProfileNameSnapshot is required".to_string());
    }
    if target
        .model_catalog_entry_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
        || target
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
    {
        return Err(
            "invalid-target: modelCatalogEntryId and runtime model are required".to_string(),
        );
    }
    validate_execution_target(target)
}

