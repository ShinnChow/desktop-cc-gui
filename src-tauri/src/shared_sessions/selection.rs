use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::engine::EngineType;
use crate::shared_event_log::{SessionTargetUpdate, SharedEventWriter};

use super::store::{
    shared_session_meta_path, with_shared_store_lock, write_string_atomically,
    SharedSessionMeta, SHARED_SESSION_SCHEMA_VERSION,
};
use super::thread_id::{canonical_shared_native_thread_id, shared_target_binding_key};
use super::{
    ensure_supported_shared_session_engine, is_supported_shared_session_engine,
    normalize_shared_session_engine,
};
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedEngineBinding {
    pub(crate) engine: EngineType,
    pub(crate) native_thread_id: String,
    pub(crate) created_at: u64,
    pub(crate) last_used_at: u64,
    pub(crate) last_synced_turn_seq: u64,
}

/// Target 级 Binding（Wave 4 / B.2）：Binding Key = Engine + ProviderProfile。
/// `provider_profile_id = None` 表示 default/local Provider 语义（旧 V0 binding 的归位点）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedTargetBindingMeta {
    pub(crate) binding_key: String,
    pub(crate) engine: EngineType,
    pub(crate) provider_profile_id: Option<String>,
    pub(crate) native_thread_id: String,
    pub(crate) created_at: u64,
    pub(crate) last_used_at: u64,
    pub(crate) last_synced_turn_seq: u64,
    /// ready / missing-provider / missing-runtime / degraded / recovery-required。
    #[serde(default = "default_target_binding_availability")]
    pub(crate) availability: String,
}

pub(crate) fn default_target_binding_availability() -> String {
    "ready".to_string()
}

pub(crate) fn normalize_provider_selection_source(value: Option<String>) -> Option<String> {
    value
        .map(|source| source.trim().to_string())
        .filter(|source| matches!(source.as_str(), "disk" | "managed"))
}

/// 当前选中的 Execution Target（Wave 4 / B.2 任务 2.3）。
/// `provider_profile_id = None` 表示 default/local Provider 语义。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedSelectedReasoning {
    pub(crate) effort: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedSelectedTarget {
    pub(crate) engine: EngineType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_profile_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) model_catalog_entry_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) reasoning: Option<SharedSelectedReasoning>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_profile_name_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_profile_source: Option<String>,
}

pub(crate) fn normalize_shared_selected_target(mut target: SharedSelectedTarget) -> SharedSelectedTarget {
    target.provider_profile_id = target
        .provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    target.model_catalog_entry_id = target
        .model_catalog_entry_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    target.model = target
        .model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    target.reasoning = target.reasoning.and_then(|mut reasoning| {
        reasoning.effort = reasoning.effort.trim().to_string();
        (!reasoning.effort.is_empty()).then_some(reasoning)
    });
    target.provider_profile_name_snapshot = target
        .provider_profile_name_snapshot
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    target.provider_profile_source =
        normalize_provider_selection_source(target.provider_profile_source);
    target
}

pub(crate) fn legacy_engine_only_selected_target(engine: EngineType) -> SharedSelectedTarget {
    SharedSelectedTarget {
        engine,
        provider_profile_id: None,
        model_catalog_entry_id: None,
        model: None,
        reasoning: None,
        provider_profile_name_snapshot: None,
        provider_profile_source: None,
    }
}

pub(crate) fn is_legacy_engine_only_selected_target(target: &SharedSelectedTarget) -> bool {
    target.provider_profile_id.is_none()
        && target.model_catalog_entry_id.is_none()
        && target.model.is_none()
        && target.reasoning.is_none()
        && target.provider_profile_name_snapshot.is_none()
        && target.provider_profile_source.is_none()
}

pub(crate) fn validate_resolved_shared_selected_target(target: &SharedSelectedTarget) -> Result<(), String> {
    let engine = ensure_supported_shared_session_engine(target.engine)?;
    let provider_profile_id = target.provider_profile_id.as_deref();
    let expected_source = if provider_profile_id.is_some() {
        "managed"
    } else {
        "disk"
    };
    if target.provider_profile_source.as_deref() != Some(expected_source) {
        return Err(format!(
            "invalid-shared-target: provider source must be '{expected_source}'"
        ));
    }
    if target.provider_profile_name_snapshot.is_none() {
        return Err("invalid-shared-target: provider name snapshot is required".to_string());
    }
    if target.model_catalog_entry_id.is_none() || target.model.is_none() {
        return Err(
            "invalid-shared-target: modelCatalogEntryId and runtime model are required".to_string(),
        );
    }
    let models = match provider_profile_id {
        Some(provider_profile_id) => crate::engine::status::get_provider_scoped_engine_models(
            engine,
            Some(provider_profile_id),
        )?,
        None => crate::engine::status::get_local_engine_models_for_validation(engine),
    };
    // 与 shared_session_v2::validate_execution_target 同策：Qoder 模型目录是 ACP
    // runtime-only（无静态 fallback roster），选择/持久化路径不得因目录不可得硬失败；
    // catalog 可用时仍交叉校验 entry/model pair。
    let models = match (engine, models) {
        (EngineType::Qoder, None) => Vec::new(),
        (_, Some(models)) => models,
        (_, None) => {
            return Err(format!(
                "invalid-shared-target: model catalog is unavailable for {} provider {}",
                engine.icon(),
                provider_profile_id.unwrap_or("default")
            ));
        }
    };
    // 不限制用户模型名：catalog 未登记的自定义模型也允许保存为 next-send target。
    crate::engine::status::validate_model_catalog_pair(
        target.model_catalog_entry_id.as_deref(),
        target.model.as_deref(),
        &models,
        crate::engine::status::UnlistedRuntimeModelPolicy::Allow,
    )
}

pub(crate) fn sanitize_shared_session_meta(meta: &mut SharedSessionMeta) {
    meta.schema_version = SHARED_SESSION_SCHEMA_VERSION;
    // 任务 2.3：`selectedEngine → selectedTarget` 迁移；selectedTarget 为权威，
    // selected_engine 回落为 target.engine（V0 回滚读取兼容）。
    let mut selected_target = match meta.selected_target.take() {
        Some(mut target) => {
            if !is_supported_shared_session_engine(target.engine) {
                target.engine = normalize_shared_session_engine(target.engine);
                target.provider_profile_id = None;
                target.model_catalog_entry_id = None;
                target.model = None;
                target.reasoning = None;
                target.provider_profile_name_snapshot = None;
                target.provider_profile_source = None;
            }
            target.provider_profile_id = target
                .provider_profile_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            target
        }
        None => SharedSelectedTarget {
            engine: normalize_shared_session_engine(meta.selected_engine),
            provider_profile_id: None,
            model_catalog_entry_id: None,
            model: None,
            reasoning: None,
            provider_profile_name_snapshot: None,
            provider_profile_source: None,
        },
    };
    selected_target.model_catalog_entry_id = selected_target
        .model_catalog_entry_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    selected_target.model = selected_target
        .model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    selected_target.reasoning = selected_target.reasoning.and_then(|mut reasoning| {
        reasoning.effort = reasoning.effort.trim().to_string();
        (!reasoning.effort.is_empty()).then_some(reasoning)
    });
    selected_target.provider_profile_name_snapshot = selected_target
        .provider_profile_name_snapshot
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    selected_target.provider_profile_source =
        normalize_provider_selection_source(selected_target.provider_profile_source);
    meta.selected_engine = selected_target.engine;
    meta.selected_target = Some(selected_target);
    meta.bindings_by_engine
        .retain(|engine, _| is_supported_shared_session_engine(*engine));
    for (engine, binding) in meta.bindings_by_engine.iter_mut() {
        binding.engine = *engine;
        binding.native_thread_id =
            canonical_shared_native_thread_id(*engine, None, &binding.native_thread_id);
    } // B.2 迁移：旧 `bindings_by_engine` 归位到 default-provider 语义。
      // V0 仍是 default binding 身份字段的权威来源（回滚兼容），
      // 因此 default key 的身份字段以 engine binding 为准做覆盖式同步；
      // managed-provider 条目（provider_profile_id != None）不受此影响。
    meta.bindings_by_target.retain(|key, binding| {
        key == &binding.binding_key && is_supported_shared_session_engine(binding.engine)
    });
    for binding in meta.bindings_by_target.values_mut() {
        binding.native_thread_id = canonical_shared_native_thread_id(
            binding.engine,
            binding.provider_profile_id.as_deref(),
            &binding.native_thread_id,
        );
    }
    for (engine, binding) in meta.bindings_by_engine.iter() {
        let key = shared_target_binding_key(*engine, None);
        match meta.bindings_by_target.get_mut(&key) {
            Some(target) => {
                target.engine = *engine;
                target.provider_profile_id = None;
                target.native_thread_id = binding.native_thread_id.clone();
                target.created_at = binding.created_at;
                target.last_used_at = binding.last_used_at;
                target.last_synced_turn_seq = binding.last_synced_turn_seq;
            }
            None => {
                meta.bindings_by_target.insert(
                    key.clone(),
                    SharedTargetBindingMeta {
                        binding_key: key,
                        engine: *engine,
                        provider_profile_id: None,
                        native_thread_id: binding.native_thread_id.clone(),
                        created_at: binding.created_at,
                        last_used_at: binding.last_used_at,
                        last_synced_turn_seq: binding.last_synced_turn_seq,
                        availability: default_target_binding_availability(),
                    },
                );
            }
        }
    }
    // default binding 在 engine map 中已不存在时，target map 也不应残留（例如 sanitize 剔除不支持 engine）。
    let live_default_keys: std::collections::HashSet<String> = meta
        .bindings_by_engine
        .keys()
        .map(|engine| shared_target_binding_key(*engine, None))
        .collect();
    meta.bindings_by_target.retain(|key, binding| {
        binding.provider_profile_id.is_some() || live_default_keys.contains(key)
    });
}

/// 更新选中 Target（同时写 V0 `selected_engine` 保持回滚兼容）。
pub(crate) fn select_meta_target(
    meta: &mut SharedSessionMeta,
    engine: EngineType,
    provider_profile_id: Option<String>,
) {
    let provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let preserved = meta.selected_target.take().filter(|target| {
        target.engine == engine && target.provider_profile_id == provider_profile_id
    });
    meta.selected_engine = engine;
    meta.selected_target = Some(preserved.unwrap_or(SharedSelectedTarget {
        engine,
        provider_profile_id,
        model_catalog_entry_id: None,
        model: None,
        reasoning: None,
        provider_profile_name_snapshot: None,
        provider_profile_source: None,
    }));
}

pub(crate) fn apply_selected_target_selection(
    root: &mut Value,
    target: &SharedSelectedTarget,
    updated_at: u64,
) -> Result<(), String> {
    let object = root
        .as_object_mut()
        .ok_or_else(|| "Shared session metadata must be a JSON object".to_string())?;
    object.insert(
        "selectedEngine".to_string(),
        serde_json::to_value(target.engine).map_err(|error| error.to_string())?,
    );
    object.insert(
        "selectedTarget".to_string(),
        serde_json::to_value(target).map_err(|error| error.to_string())?,
    );
    object.insert("updatedAt".to_string(), json!(updated_at));
    Ok(())
}

pub(crate) fn write_shared_session_selection(
    workspace_id: &str,
    shared_session_id: &str,
    target: &SharedSelectedTarget,
    updated_at: u64,
    writer: &SharedEventWriter,
) -> Result<SharedSelectedTarget, String> {
    let path = shared_session_meta_path(workspace_id, shared_session_id)?;
    with_shared_store_lock(&path, || {
        let raw = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
        let mut root: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
        let selected_target = if is_legacy_engine_only_selected_target(target) {
            let mut meta: SharedSessionMeta =
                serde_json::from_value(root.clone()).map_err(|error| error.to_string())?;
            sanitize_shared_session_meta(&mut meta);
            resolve_shared_selection_update(&mut meta, target)
        } else {
            target.clone()
        };
        apply_selected_target_selection(&mut root, &selected_target, updated_at)?;
        let updated_raw = serde_json::to_string_pretty(&root).map_err(|error| error.to_string())?;
        write_string_atomically(&path, &updated_raw)?;
        if let Err(error) =
            upsert_v2_selected_target(writer, shared_session_id, &selected_target, updated_at)
        {
            let rollback = write_string_atomically(&path, &raw);
            return Err(match rollback {
                Ok(()) => error,
                Err(rollback_error) => {
                    format!("{error}; legacy metadata rollback also failed: {rollback_error}")
                }
            });
        }
        Ok(selected_target)
    })
}

pub(crate) fn upsert_v2_selected_target(
    writer: &SharedEventWriter,
    shared_session_id: &str,
    target: &SharedSelectedTarget,
    updated_at: u64,
) -> Result<(), String> {
    let selected_target_json = serde_json::to_string(target).map_err(|error| error.to_string())?;
    writer
        .upsert_session_target(&SessionTargetUpdate {
            session_id: shared_session_id.to_string(),
            schema_version: SHARED_SESSION_SCHEMA_VERSION,
            selected_target_json,
            updated_at: updated_at as i64,
        })
        .map_err(|error| error.to_string())
}

pub(crate) fn select_meta_engine_compat(meta: &mut SharedSessionMeta, engine: EngineType) {
    if meta
        .selected_target
        .as_ref()
        .is_some_and(|target| target.engine == engine)
    {
        meta.selected_engine = engine;
        return;
    }
    select_meta_target(meta, engine, None);
}

pub(crate) fn resolve_shared_selection_update(
    meta: &mut SharedSessionMeta,
    requested_target: &SharedSelectedTarget,
) -> SharedSelectedTarget {
    if !is_legacy_engine_only_selected_target(requested_target) {
        return requested_target.clone();
    }
    select_meta_engine_compat(meta, requested_target.engine);
    meta.selected_target
        .clone()
        .unwrap_or_else(|| legacy_engine_only_selected_target(requested_target.engine))
}
