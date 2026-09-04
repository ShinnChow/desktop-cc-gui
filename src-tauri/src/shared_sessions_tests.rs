use super::{
    apply_selected_target_selection, apply_shared_snapshot_presentation_metadata,
    binding_uses_established_native_thread, build_delta_sync_prefix, count_user_turns,
    extract_first_user_title, inspect_shared_context_projection,
    is_legacy_engine_only_selected_target, is_pending_shared_binding_thread_id,
    legacy_engine_only_selected_target, normalize_provider_selection_source,
    normalize_shared_selected_target, parse_shared_session_id, resolve_shared_selection_update,
    sanitize_shared_session_meta, select_meta_engine_compat, select_meta_target,
    shared_target_binding_key, validate_resolved_shared_selected_target,
    validate_shared_native_thread_id, SharedEngineBinding, SharedSelectedReasoning,
    SharedSelectedTarget, SharedSessionMeta, SharedTargetBindingMeta, MAX_DELTA_SYNC_CHARS,
    SHARED_SESSION_SCHEMA_VERSION,
};
use crate::engine::EngineType;
use serde_json::{json, Value};
use std::collections::HashMap;

#[test]
fn ownership_seed_skips_meta_less_leftover_dirs_but_counts_corrupt_meta() {
    let dir = std::env::temp_dir().join(format!(
        "mossx-ownership-seed-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    // 崩溃/中断创建的残留空目录（无 meta.json）→ 静默跳过，不计 skipped_meta
    std::fs::create_dir_all(dir.join("leftover-empty")).expect("mkdir empty");
    // meta.json 存在但损坏 → 保守策略记 skipped_meta
    std::fs::create_dir_all(dir.join("corrupt")).expect("mkdir corrupt");
    std::fs::write(dir.join("corrupt").join("meta.json"), "{not json").expect("write");
    // 正常 meta → 收录
    std::fs::create_dir_all(dir.join("good")).expect("mkdir good");
    std::fs::write(
        dir.join("good").join("meta.json"),
        r#"{
            "id": "good-session",
            "workspaceId": "ws-1",
            "title": "t",
            "createdAt": 1,
            "updatedAt": 1,
            "selectedEngine": "claude",
            "lastTurnSeq": 0,
            "bindingsByEngine": {},
            "bindingsByTarget": {}
        }"#,
    )
    .expect("write good");

    let seed = super::load_seed_from_shared_sessions_dir(&dir).expect("seed");
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(seed.skipped_meta, 1, "only corrupt meta counts as skipped");
    assert!(
        seed.session_ids.iter().any(|id| id == "good-session"),
        "good meta collected: {:?}",
        seed.session_ids
    );
    assert!(
        !seed.session_ids.iter().any(|id| id.contains("leftover")),
        "meta-less leftover dir must be ignored: {:?}",
        seed.session_ids
    );
}

#[test]
fn derives_title_from_first_user_message() {
    let items = vec![
        json!({ "id": "u1", "kind": "message", "role": "user", "text": "帮我看看 shared session 该怎么做" }),
        json!({ "id": "a1", "kind": "message", "role": "assistant", "text": "好的" }),
    ];
    let title = extract_first_user_title(&items);
    assert_eq!(title.as_deref(), Some("帮我看看 shared session 该怎么做"));
}

#[test]
fn counts_user_turns_from_snapshot_items() {
    let items = vec![
        json!({ "id": "u1", "kind": "message", "role": "user", "text": "A" }),
        json!({ "id": "a1", "kind": "message", "role": "assistant", "text": "B" }),
        json!({ "id": "u2", "kind": "message", "role": "user", "text": "C" }),
    ];
    assert_eq!(count_user_turns(&items), 2);
}

#[test]
fn builds_delta_sync_prefix_from_newer_turns_only() {
    let items = vec![
        json!({ "id": "u1", "kind": "message", "role": "user", "text": "first user" }),
        json!({ "id": "a1", "kind": "message", "role": "assistant", "text": "first assistant", "engineSource": "claude" }),
        json!({ "id": "u2", "kind": "message", "role": "user", "text": "second user" }),
        json!({ "id": "a2", "kind": "message", "role": "assistant", "text": "second assistant", "engineSource": "codex" }),
    ];
    let prefix = build_delta_sync_prefix(&items, 1).expect("prefix");
    assert!(prefix.contains("Turn 2"));
    assert!(prefix.contains("second user"));
    assert!(prefix.contains("codex"));
    assert!(!prefix.contains("first assistant"));
}

#[test]
fn delta_sync_keeps_the_latest_bounded_turns() {
    let items = (1..=10)
        .flat_map(|turn| {
            [
                json!({ "kind": "message", "role": "user", "text": format!("user-{turn}") }),
                json!({ "kind": "message", "role": "assistant", "text": format!("assistant-{turn}") }),
            ]
        })
        .collect::<Vec<_>>();

    let prefix = build_delta_sync_prefix(&items, 0).expect("prefix");
    assert!(!prefix.contains("Turn 1\n"));
    assert!(!prefix.contains("Turn 2\n"));
    assert!(prefix.contains("Turn 3\n"));
    assert!(prefix.contains("Turn 10\n"));
}

#[test]
fn delta_sync_truncates_unicode_by_characters_and_reports_it() {
    let items = vec![
        json!({ "kind": "message", "role": "user", "text": "问题" }),
        json!({ "kind": "message", "role": "assistant", "text": "答".repeat(MAX_DELTA_SYNC_CHARS) }),
    ];

    let prefix = build_delta_sync_prefix(&items, 0).expect("prefix");
    assert!(prefix.chars().count() <= MAX_DELTA_SYNC_CHARS);
    assert_eq!(
        inspect_shared_context_projection(&items, 0),
        vec![format!(
            "context truncated at the {}-character limit",
            MAX_DELTA_SYNC_CHARS
        )]
    );
}

#[test]
fn detects_pending_shared_binding_ids() {
    for engine in [
        EngineType::Claude,
        EngineType::Codex,
        EngineType::Kimi,
        EngineType::Grok,
        EngineType::OpenCode,
        EngineType::Pi,
        EngineType::Qoder,
    ] {
        assert!(is_pending_shared_binding_thread_id(
            engine,
            &format!("{}-pending-shared-1", engine.icon()),
        ));
    }
    assert!(!is_pending_shared_binding_thread_id(
        EngineType::Codex,
        "550e8400-e29b-41d4-a716-446655440000"
    ));
    assert!(!is_pending_shared_binding_thread_id(
        EngineType::Codex,
        "codex-native-thread-1"
    ));
}

#[test]
fn requires_established_native_thread_before_reusing_binding() {
    assert!(!binding_uses_established_native_thread(
        EngineType::Claude,
        "claude-pending-shared-1"
    ));
    assert!(binding_uses_established_native_thread(
        EngineType::Claude,
        "claude:session-1"
    ));
    assert!(!binding_uses_established_native_thread(
        EngineType::Codex,
        "codex-pending-shared-1"
    ));
    assert!(binding_uses_established_native_thread(
        EngineType::Codex,
        "550e8400-e29b-41d4-a716-446655440000"
    ));
    assert!(binding_uses_established_native_thread(
        EngineType::Codex,
        "codex-native-thread-1"
    ));
    for engine in [
        EngineType::Kimi,
        EngineType::Grok,
        EngineType::OpenCode,
        EngineType::Pi,
        EngineType::Qoder,
    ] {
        assert!(!binding_uses_established_native_thread(
            engine,
            &format!("{}-pending-shared-1", engine.icon()),
        ));
        assert!(binding_uses_established_native_thread(
            engine,
            &format!("native-{}-session", engine.icon()),
        ));
        // catalog / hide set 使用的前缀形式也必须视为 established。
        assert!(binding_uses_established_native_thread(
            engine,
            &format!("{}:native-{}-session", engine.icon(), engine.icon()),
        ));
    }
}

#[test]
fn resolved_local_targets_validate_for_new_shared_cli_engines() {
    for engine in [
        EngineType::Kimi,
        EngineType::Grok,
        EngineType::OpenCode,
        EngineType::Pi,
    ] {
        let catalog = crate::engine::status::get_local_engine_models_for_validation(engine)
            .unwrap_or_else(|| panic!("missing local catalog for {engine:?}"));
        let selected = catalog
            .first()
            .unwrap_or_else(|| panic!("empty local catalog for {engine:?}"));
        let target = SharedSelectedTarget {
            engine,
            provider_profile_id: None,
            model_catalog_entry_id: Some(selected.id.clone()),
            model: Some(selected.model.clone()),
            reasoning: None,
            provider_profile_name_snapshot: Some("本地配置".to_string()),
            provider_profile_source: Some("disk".to_string()),
        };

        validate_resolved_shared_selected_target(&target)
            .unwrap_or_else(|error| panic!("{engine:?} local target rejected: {error}"));
    }
}

#[test]
fn resolved_qoder_local_target_validates_without_static_catalog() {
    // Qoder 模型目录是 ACP runtime-only：选择/持久化路径不得硬失败
    //（回归：invalid-shared-target: model catalog is unavailable for qoder）。
    let target = SharedSelectedTarget {
        engine: EngineType::Qoder,
        provider_profile_id: None,
        model_catalog_entry_id: Some("qmodel_38max".to_string()),
        model: Some("qmodel_38max".to_string()),
        reasoning: None,
        provider_profile_name_snapshot: Some("本地配置".to_string()),
        provider_profile_source: Some("disk".to_string()),
    };
    validate_resolved_shared_selected_target(&target)
        .expect("qoder runtime-only catalog must not hard-fail on select/persist");
}

#[test]
fn normalizes_legacy_shared_meta_to_supported_engines_only() {
    let mut meta = SharedSessionMeta {
        schema_version: 1,
        id: "shared-1".to_string(),
        workspace_id: "ws-1".to_string(),
        title: "Shared Session".to_string(),
        created_at: 1,
        updated_at: 2,
        selected_engine: EngineType::Gemini,
        selected_target: Some(SharedSelectedTarget {
            engine: EngineType::Gemini,
            provider_profile_id: Some("legacy-provider".to_string()),
            model_catalog_entry_id: Some("legacy-model-entry".to_string()),
            model: Some("legacy-model".to_string()),
            reasoning: Some(SharedSelectedReasoning {
                effort: "high".to_string(),
            }),
            provider_profile_name_snapshot: Some("Legacy Provider".to_string()),
            provider_profile_source: Some("managed".to_string()),
        }),
        last_turn_seq: 3,
        bindings_by_engine: HashMap::from([
            (
                EngineType::Gemini,
                SharedEngineBinding {
                    engine: EngineType::Gemini,
                    native_thread_id: "gemini:session-1".to_string(),
                    created_at: 1,
                    last_used_at: 2,
                    last_synced_turn_seq: 3,
                },
            ),
            (
                EngineType::Claude,
                SharedEngineBinding {
                    engine: EngineType::Claude,
                    native_thread_id: "claude:session-1".to_string(),
                    created_at: 1,
                    last_used_at: 2,
                    last_synced_turn_seq: 3,
                },
            ),
        ]),
        bindings_by_target: HashMap::new(),
    };

    sanitize_shared_session_meta(&mut meta);

    assert_eq!(meta.selected_engine, EngineType::Claude);
    let target = meta.selected_target.expect("normalized selected target");
    assert_eq!(target.engine, EngineType::Claude);
    assert!(target.provider_profile_id.is_none());
    assert!(target.model_catalog_entry_id.is_none());
    assert!(target.model.is_none());
    assert!(target.reasoning.is_none());
    assert!(meta.bindings_by_engine.contains_key(&EngineType::Claude));
    assert!(!meta.bindings_by_engine.contains_key(&EngineType::Gemini));
}

#[test]
fn rejects_shared_session_ids_with_path_like_segments() {
    assert!(parse_shared_session_id("shared:session-1").is_ok());
    assert!(parse_shared_session_id("shared:../session-1").is_err());
    assert!(parse_shared_session_id("shared:..\\session-1").is_err());
    assert!(parse_shared_session_id("shared:session/1").is_err());
    assert!(parse_shared_session_id("shared:session\\1").is_err());
    assert!(parse_shared_session_id("shared:").is_err());
}

#[test]
fn rejects_empty_shared_native_thread_ids() {
    assert!(validate_shared_native_thread_id("claude:session-1").is_ok());
    assert!(validate_shared_native_thread_id("   ").is_err());
}

fn meta_with_engine_binding(engine: EngineType, native_thread_id: &str) -> SharedSessionMeta {
    SharedSessionMeta {
        schema_version: 1,
        id: "shared-1".to_string(),
        workspace_id: "ws-1".to_string(),
        title: "Shared Session".to_string(),
        created_at: 1,
        updated_at: 2,
        selected_engine: engine,
        selected_target: None,
        last_turn_seq: 0,
        bindings_by_engine: HashMap::from([(
            engine,
            SharedEngineBinding {
                engine,
                native_thread_id: native_thread_id.to_string(),
                created_at: 1,
                last_used_at: 2,
                last_synced_turn_seq: 3,
            },
        )]),
        bindings_by_target: HashMap::new(),
    }
}

#[test]
fn binding_key_uses_engine_and_provider_with_default_fallback() {
    assert_eq!(
        shared_target_binding_key(EngineType::Claude, None),
        "claude:default"
    );
    assert_eq!(
        shared_target_binding_key(EngineType::Claude, Some("  ")),
        "claude:default"
    );
    assert_eq!(
        shared_target_binding_key(EngineType::Claude, Some("openrouter")),
        "claude:openrouter"
    );
    assert_eq!(
        shared_target_binding_key(EngineType::Codex, Some("openai")),
        "codex:openai"
    );
    assert_eq!(
        shared_target_binding_key(
            EngineType::Qoder,
            Some(crate::engine::qoder_provider_profile::QODER_GLOBAL_PROVIDER_PROFILE_ID),
        ),
        "qoder:__qoder_global__"
    );
    assert_eq!(
        shared_target_binding_key(
            EngineType::Qoder,
            Some(crate::engine::qoder_provider_profile::QODER_CN_PROVIDER_PROFILE_ID),
        ),
        "qoder:__qoder_cn__"
    );
}

#[test]
fn selected_target_preserves_complete_identity_for_the_same_binding() {
    let mut meta = meta_with_engine_binding(EngineType::Codex, "codex-session-1");
    meta.selected_target = Some(SharedSelectedTarget {
        engine: EngineType::Codex,
        provider_profile_id: Some("provider-kimi".to_string()),
        model_catalog_entry_id: Some("kimi-coding-entry".to_string()),
        model: Some("kimi-for-coding".to_string()),
        reasoning: Some(SharedSelectedReasoning {
            effort: "high".to_string(),
        }),
        provider_profile_name_snapshot: Some("Kimi Coding".to_string()),
        provider_profile_source: Some("managed".to_string()),
    });

    select_meta_target(
        &mut meta,
        EngineType::Codex,
        Some("provider-kimi".to_string()),
    );

    let target = meta.selected_target.expect("selected target");
    assert_eq!(
        target.model_catalog_entry_id.as_deref(),
        Some("kimi-coding-entry")
    );
    assert_eq!(target.model.as_deref(), Some("kimi-for-coding"));
    assert_eq!(
        target
            .reasoning
            .as_ref()
            .map(|reasoning| reasoning.effort.as_str()),
        Some("high")
    );
    assert_eq!(
        target.provider_profile_name_snapshot.as_deref(),
        Some("Kimi Coding")
    );
}

#[test]
fn snapshot_sync_has_no_selection_authority_even_with_a_stale_engine() {
    let mut meta = meta_with_engine_binding(EngineType::Codex, "codex-session-1");
    meta.selected_target = Some(SharedSelectedTarget {
        engine: EngineType::Codex,
        provider_profile_id: Some("provider-kimi".to_string()),
        model_catalog_entry_id: Some("kimi-coding-entry".to_string()),
        model: Some("kimi-for-coding".to_string()),
        reasoning: Some(SharedSelectedReasoning {
            effort: "high".to_string(),
        }),
        provider_profile_name_snapshot: Some("Kimi Coding".to_string()),
        provider_profile_source: Some("managed".to_string()),
    });

    apply_shared_snapshot_presentation_metadata(
        &mut meta,
        &[json!({
            "kind": "message",
            "role": "user",
            "text": "stale Claude snapshot"
        })],
        42,
    );

    let target = meta.selected_target.expect("selected target");
    assert_eq!(meta.selected_engine, EngineType::Codex);
    assert_eq!(target.provider_profile_id.as_deref(), Some("provider-kimi"));
    assert_eq!(target.model.as_deref(), Some("kimi-for-coding"));
    assert_eq!(meta.updated_at, 42);
}

#[test]
fn legacy_engine_only_selection_update_does_not_downgrade_complete_target() {
    let mut meta = meta_with_engine_binding(EngineType::Codex, "codex-session-1");
    meta.selected_target = Some(SharedSelectedTarget {
        engine: EngineType::Codex,
        provider_profile_id: Some("provider-kimi".to_string()),
        model_catalog_entry_id: Some("kimi-coding-entry".to_string()),
        model: Some("kimi-for-coding".to_string()),
        reasoning: Some(SharedSelectedReasoning {
            effort: "high".to_string(),
        }),
        provider_profile_name_snapshot: Some("Kimi Coding".to_string()),
        provider_profile_source: Some("managed".to_string()),
    });
    let legacy_update = legacy_engine_only_selected_target(EngineType::Codex);

    let selected_target = resolve_shared_selection_update(&mut meta, &legacy_update);

    assert_eq!(
        selected_target.provider_profile_id.as_deref(),
        Some("provider-kimi"),
    );
    assert_eq!(
        selected_target.model_catalog_entry_id.as_deref(),
        Some("kimi-coding-entry"),
    );
    assert_eq!(selected_target.model.as_deref(), Some("kimi-for-coding"));
}

#[test]
fn resolved_selected_target_validation_rejects_legacy_partial_identity() {
    let partial = legacy_engine_only_selected_target(EngineType::Codex);

    assert!(is_legacy_engine_only_selected_target(&partial));
    assert!(validate_resolved_shared_selected_target(&partial)
        .expect_err("legacy partial target must not become executable")
        .contains("provider source"),);
}

#[test]
fn selected_target_normalization_preserves_missing_legacy_fields() {
    let normalized = normalize_shared_selected_target(SharedSelectedTarget {
        engine: EngineType::Claude,
        provider_profile_id: Some("   ".to_string()),
        model_catalog_entry_id: None,
        model: None,
        reasoning: None,
        provider_profile_name_snapshot: None,
        provider_profile_source: Some("unknown".to_string()),
    });

    assert!(is_legacy_engine_only_selected_target(&normalized));
}

#[test]
fn selected_target_optional_fields_round_trip_and_legacy_fields_default() {
    let full: SharedSelectedTarget = serde_json::from_value(json!({
        "engine": "codex",
        "providerProfileId": "provider-kimi",
        "modelCatalogEntryId": "kimi-coding-entry",
        "model": "kimi-for-coding",
        "reasoning": { "effort": "high" },
        "providerProfileNameSnapshot": "Kimi Coding",
        "providerProfileSource": "managed"
    }))
    .expect("full selected target");
    let serialized = serde_json::to_value(&full).expect("serialize selected target");
    assert_eq!(
        serialized
            .get("modelCatalogEntryId")
            .and_then(|value| value.as_str()),
        Some("kimi-coding-entry")
    );
    assert_eq!(
        serialized.get("model").and_then(|value| value.as_str()),
        Some("kimi-for-coding")
    );

    let legacy: SharedSelectedTarget =
        serde_json::from_value(json!({ "engine": "claude" })).expect("legacy selected target");
    assert!(legacy.provider_profile_id.is_none());
    assert!(legacy.model_catalog_entry_id.is_none());
    assert!(legacy.model.is_none());
    assert!(legacy.reasoning.is_none());
}

#[test]
fn picker_selection_does_not_create_or_touch_same_engine_provider_bindings() {
    let mut meta = meta_with_engine_binding(EngineType::Codex, "codex-local-session");
    meta.bindings_by_target.insert(
        "codex:provider-a".to_string(),
        SharedTargetBindingMeta {
            binding_key: "codex:provider-a".to_string(),
            engine: EngineType::Codex,
            provider_profile_id: Some("provider-a".to_string()),
            native_thread_id: "codex-provider-a-session".to_string(),
            created_at: 1,
            last_used_at: 2,
            last_synced_turn_seq: 3,
            availability: "ready".to_string(),
        },
    );
    let mut root = serde_json::to_value(meta).expect("serialize metadata fixture");
    let engine_bindings_before = root.get("bindingsByEngine").cloned();
    let target_bindings_before = root.get("bindingsByTarget").cloned();
    let selected_target = SharedSelectedTarget {
        engine: EngineType::Codex,
        provider_profile_id: Some("provider-b".to_string()),
        model_catalog_entry_id: Some("provider-b-entry".to_string()),
        model: Some("provider-b-runtime".to_string()),
        reasoning: None,
        provider_profile_name_snapshot: Some("Provider B".to_string()),
        provider_profile_source: Some("managed".to_string()),
    };

    apply_selected_target_selection(&mut root, &selected_target, 99)
        .expect("apply selection-only patch");

    assert_eq!(
        root.get("bindingsByEngine").cloned(),
        engine_bindings_before
    );
    assert_eq!(
        root.get("bindingsByTarget").cloned(),
        target_bindings_before
    );
    assert!(
        root.pointer("/bindingsByTarget/codex:provider-b").is_none(),
        "selection must not materialize a Provider binding"
    );
    assert_eq!(root.get("updatedAt").and_then(Value::as_u64), Some(99));
    assert_eq!(
        root.pointer("/selectedTarget/providerProfileId")
            .and_then(Value::as_str),
        Some("provider-b")
    );
}

#[test]
fn selected_target_source_accepts_catalog_values_and_drops_unknown_values() {
    assert_eq!(
        normalize_provider_selection_source(Some(" disk ".to_string())).as_deref(),
        Some("disk")
    );
    assert_eq!(
        normalize_provider_selection_source(Some("managed".to_string())).as_deref(),
        Some("managed")
    );
    assert!(
        normalize_provider_selection_source(Some("local".to_string())).is_none(),
        "selected target persists catalog-domain source, not canonical source"
    );
    assert!(normalize_provider_selection_source(Some("future-source".to_string())).is_none());
}

#[test]
fn migrates_legacy_engine_bindings_to_default_provider_targets() {
    let mut meta = meta_with_engine_binding(EngineType::Claude, "claude:session-1");
    sanitize_shared_session_meta(&mut meta);

    let target = meta
        .bindings_by_target
        .get("claude:default")
        .expect("default target binding");
    assert_eq!(target.provider_profile_id, None);
    assert_eq!(target.native_thread_id, "claude:session-1");
    assert_eq!(target.last_synced_turn_seq, 3);
    assert_eq!(target.availability, "ready");
}

#[test]
fn sanitize_keeps_engine_binding_authoritative_for_default_identity() {
    let mut meta = meta_with_engine_binding(EngineType::Claude, "claude:session-new");
    meta.bindings_by_target.insert(
        "claude:default".to_string(),
        SharedTargetBindingMeta {
            binding_key: "claude:default".to_string(),
            engine: EngineType::Claude,
            provider_profile_id: None,
            native_thread_id: "claude:session-stale".to_string(),
            created_at: 9,
            last_used_at: 9,
            last_synced_turn_seq: 9,
            availability: "recovery-required".to_string(),
        },
    );
    sanitize_shared_session_meta(&mut meta);

    let target = meta
        .bindings_by_target
        .get("claude:default")
        .expect("default target binding");
    // 身份字段以 V0 engine binding 为准（回滚兼容）；availability 保留 V2 状态。
    assert_eq!(target.native_thread_id, "claude:session-new");
    assert_eq!(target.last_synced_turn_seq, 3);
    assert_eq!(target.availability, "recovery-required");
}

#[test]
fn sanitize_qualifies_qoder_bindings_by_distribution() {
    let mut meta = meta_with_engine_binding(EngineType::Qoder, "same-qoder-session");
    meta.bindings_by_target.insert(
        "qoder:__qoder_cn__".to_string(),
        SharedTargetBindingMeta {
            binding_key: "qoder:__qoder_cn__".to_string(),
            engine: EngineType::Qoder,
            provider_profile_id: Some("__qoder_cn__".to_string()),
            native_thread_id: "same-qoder-session".to_string(),
            created_at: 1,
            last_used_at: 2,
            last_synced_turn_seq: 3,
            availability: "ready".to_string(),
        },
    );

    sanitize_shared_session_meta(&mut meta);

    assert_eq!(
        meta.bindings_by_engine[&EngineType::Qoder].native_thread_id,
        "qoder:__qoder_global__:same-qoder-session"
    );
    assert_eq!(
        meta.bindings_by_target["qoder:default"].native_thread_id,
        "qoder:__qoder_global__:same-qoder-session"
    );
    assert_eq!(
        meta.bindings_by_target["qoder:__qoder_cn__"].native_thread_id,
        "qoder:__qoder_cn__:same-qoder-session"
    );
}

#[test]
fn sanitize_preserves_managed_provider_targets_untouched() {
    let mut meta = meta_with_engine_binding(EngineType::Claude, "claude:session-1");
    meta.bindings_by_target.insert(
        "claude:openrouter".to_string(),
        SharedTargetBindingMeta {
            binding_key: "claude:openrouter".to_string(),
            engine: EngineType::Claude,
            provider_profile_id: Some("openrouter".to_string()),
            native_thread_id: "claude:session-or".to_string(),
            created_at: 5,
            last_used_at: 6,
            last_synced_turn_seq: 7,
            availability: "degraded".to_string(),
        },
    );
    sanitize_shared_session_meta(&mut meta);

    let managed = meta
        .bindings_by_target
        .get("claude:openrouter")
        .expect("managed provider binding");
    assert_eq!(managed.native_thread_id, "claude:session-or");
    assert_eq!(managed.last_synced_turn_seq, 7);
    assert_eq!(managed.availability, "degraded");
    assert!(meta.bindings_by_target.contains_key("claude:default"));
}

#[test]
fn sanitize_drops_target_bindings_whose_engine_is_unsupported() {
    let mut meta = meta_with_engine_binding(EngineType::Claude, "claude:session-1");
    meta.bindings_by_target.insert(
        "gemini:default".to_string(),
        SharedTargetBindingMeta {
            binding_key: "gemini:default".to_string(),
            engine: EngineType::Gemini,
            provider_profile_id: None,
            native_thread_id: "gemini:session-1".to_string(),
            created_at: 1,
            last_used_at: 2,
            last_synced_turn_seq: 3,
            availability: "ready".to_string(),
        },
    );
    sanitize_shared_session_meta(&mut meta);

    assert!(!meta.bindings_by_target.contains_key("gemini:default"));
}

#[test]
fn legacy_meta_without_target_map_deserializes_via_default() {
    let raw = json!({
        "id": "shared-1",
        "workspaceId": "ws-1",
        "title": "Shared Session",
        "createdAt": 1,
        "updatedAt": 2,
        "selectedEngine": "claude",
        "lastTurnSeq": 0,
        "bindingsByEngine": {},
    });
    let mut meta: SharedSessionMeta = serde_json::from_value(raw).expect("legacy meta parses");
    sanitize_shared_session_meta(&mut meta);
    assert_eq!(meta.schema_version, SHARED_SESSION_SCHEMA_VERSION);
    assert!(meta.bindings_by_target.is_empty());
}
