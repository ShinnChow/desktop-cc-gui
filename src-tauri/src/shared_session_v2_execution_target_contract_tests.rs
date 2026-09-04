use super::*;

#[test]
fn execution_target_input_accepts_canonical_local_and_rejects_catalog_disk() {
    let local = serde_json::from_value::<ExecutionTargetInput>(json!({
        "engine": "codex",
        "providerProfileId": null,
        "modelCatalogEntryId": "gpt-5.3-codex-spark",
        "model": "gpt-5.3-codex-spark",
        "reasoningEffort": null,
        "providerProfileNameSnapshot": "本地配置",
        "providerProfileSource": "local",
        "runtimeCapabilityFingerprint": null
    }))
    .expect("canonical local target");
    assert_eq!(
        local.to_snapshot().provider_profile_source,
        Some(CanonicalProviderProfileSource::Local)
    );
    assert_eq!(
        local.model_catalog_entry_id.as_deref(),
        Some("gpt-5.3-codex-spark")
    );
    assert_eq!(
        local.to_snapshot().model_catalog_entry_id.as_deref(),
        Some("gpt-5.3-codex-spark")
    );

    let error = serde_json::from_value::<ExecutionTargetInput>(json!({
        "engine": "codex",
        "providerProfileSource": "disk"
    }))
    .expect_err("catalog source must not cross canonical IPC boundary");
    assert!(error.to_string().contains("unknown variant"));
}

#[test]
fn claude_session_identity_accepts_legacy_raw_and_canonical_prefix() {
    assert_eq!(raw_claude_session_id("legacy-uuid"), Some("legacy-uuid"));
    assert_eq!(
        raw_claude_session_id("claude:canonical-uuid"),
        Some("canonical-uuid")
    );
    assert_eq!(raw_claude_session_id("claude:"), None);
}

#[test]
fn execution_target_validation_rejects_mismatched_catalog_runtime_pair() {
    // 从当前 generatedModelCatalog 动态取条目，避免模型目录漂移使用例失效。
    let catalog =
        crate::engine::status::get_local_engine_models_for_validation(EngineType::Codex)
            .expect("codex local catalog");
    let selected = catalog.first().expect("non-empty codex catalog");
    let expected_runtime_model = if selected.model.trim().is_empty() {
        selected.id.trim().to_string()
    } else {
        selected.model.trim().to_string()
    };
    let valid = ExecutionTargetInput {
        engine: EngineType::Codex,
        provider_profile_id: None,
        model_catalog_entry_id: Some(selected.id.clone()),
        model: Some(expected_runtime_model.clone()),
        reasoning_effort: None,
        provider_profile_name_snapshot: Some("本地配置".to_string()),
        provider_profile_source: Some(CanonicalProviderProfileSource::Local),
        runtime_capability_fingerprint: None,
    };
    assert_eq!(
        validate_resolved_execution_target(&valid).expect("valid resolved local Codex pair"),
        EngineType::Codex
    );

    let poisoned = ExecutionTargetInput {
        model: Some("kimi-for-coding".to_string()),
        ..valid
    };
    assert!(validate_resolved_execution_target(&poisoned)
        .expect_err("mismatched runtime model must fail before the turn is persisted")
        .contains(&format!(
            "requires runtime model '{expected_runtime_model}'"
        )));
}

#[test]
fn execution_target_validation_accepts_new_shared_cli_local_catalogs() {
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
        let target = ExecutionTargetInput {
            engine,
            provider_profile_id: None,
            model_catalog_entry_id: Some(selected.id.clone()),
            model: Some(selected.model.clone()),
            reasoning_effort: None,
            provider_profile_name_snapshot: Some("本地配置".to_string()),
            provider_profile_source: Some(CanonicalProviderProfileSource::Local),
            runtime_capability_fingerprint: None,
        };

        assert_eq!(
            validate_resolved_execution_target(&target)
                .unwrap_or_else(|error| panic!("{engine:?} local target rejected: {error}")),
            engine
        );
    }
}

#[test]
fn resolved_execution_target_rejects_legacy_partial_identity() {
    let partial = ExecutionTargetInput {
        engine: EngineType::Codex,
        provider_profile_id: None,
        model_catalog_entry_id: None,
        model: None,
        reasoning_effort: None,
        provider_profile_name_snapshot: None,
        provider_profile_source: None,
        runtime_capability_fingerprint: None,
    };

    assert!(validate_resolved_execution_target(&partial)
        .expect_err("legacy partial target must fail closed")
        .contains("providerProfileSource"),);
}

#[test]
fn resolved_execution_target_requires_source_to_match_provider_identity() {
    let managed_with_local_source = ExecutionTargetInput {
        engine: EngineType::Codex,
        provider_profile_id: Some("provider-kimi".to_string()),
        model_catalog_entry_id: Some("kimi-entry".to_string()),
        model: Some("kimi-for-coding".to_string()),
        reasoning_effort: None,
        provider_profile_name_snapshot: Some("Kimi".to_string()),
        provider_profile_source: Some(CanonicalProviderProfileSource::Local),
        runtime_capability_fingerprint: None,
    };

    assert!(
        validate_resolved_execution_target(&managed_with_local_source)
            .expect_err("managed provider cannot claim local provenance")
            .contains("must be 'managed'"),
    );
}

#[test]
fn claude_shared_context_always_requires_exact_replay_echo() {
    let target = ExecutionTargetInput {
        engine: EngineType::Claude,
        provider_profile_id: None,
        model_catalog_entry_id: Some("claude-sonnet-4-5".to_string()),
        model: Some("claude-sonnet-4-5".to_string()),
        reasoning_effort: None,
        provider_profile_name_snapshot: Some("本地配置".to_string()),
        provider_profile_source: Some(CanonicalProviderProfileSource::Local),
        runtime_capability_fingerprint: None,
    };

    assert!(context_capabilities(&target).strong_context_ack);
}

#[test]
fn codex_shared_context_uses_weak_portable_transcript() {
    let target = ExecutionTargetInput {
        engine: EngineType::Codex,
        provider_profile_id: Some("compatible-provider".to_string()),
        model_catalog_entry_id: Some("codex-model".to_string()),
        model: Some("codex-model".to_string()),
        reasoning_effort: None,
        provider_profile_name_snapshot: Some("Compatible Provider".to_string()),
        provider_profile_source: Some(CanonicalProviderProfileSource::Managed),
        runtime_capability_fingerprint: Some("thread/inject_items".to_string()),
    };

    let capabilities = context_capabilities(&target);
    assert!(capabilities.user_channel_transcript);
    assert!(!capabilities.structured_history_import);
    assert!(!capabilities.tool_history);
    assert!(!capabilities.strong_context_ack);
}

#[test]
fn newly_supported_shared_engines_use_weak_user_channel_context() {
    for engine in [
        EngineType::Kimi,
        EngineType::Grok,
        EngineType::OpenCode,
        EngineType::Pi,
        EngineType::Qoder,
    ] {
        let target = ExecutionTargetInput {
            engine,
            provider_profile_id: None,
            model_catalog_entry_id: Some("runtime-model".to_string()),
            model: Some("runtime-model".to_string()),
            reasoning_effort: None,
            provider_profile_name_snapshot: Some("本地配置".to_string()),
            provider_profile_source: Some(CanonicalProviderProfileSource::Local),
            runtime_capability_fingerprint: None,
        };
        let capabilities = context_capabilities(&target);
        assert!(capabilities.user_channel_transcript, "{engine:?}");
        assert!(!capabilities.structured_history_import, "{engine:?}");
        assert!(!capabilities.strong_context_ack, "{engine:?}");
    }
}

#[test]
fn newly_supported_shared_engines_use_provider_scoped_runtime_keys() {
    for (engine, local_suffix, managed_suffix) in [
        (
            EngineType::Kimi,
            crate::engine::kimi_provider_profile::KIMI_LOCAL_PROVIDER_PROFILE_ID,
            "provider-kimi",
        ),
        (
            EngineType::Grok,
            crate::engine::grok_provider_profile::GROK_LOCAL_PROVIDER_PROFILE_ID,
            "provider-grok",
        ),
        (
            EngineType::OpenCode,
            crate::engine::opencode_provider_profile::OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
            "provider-opencode",
        ),
    ] {
        assert_eq!(
            provider_runtime_key_for_target("workspace-1", engine, None)
                .expect("local runtime key"),
            format!("{}::workspace-1::{local_suffix}", engine.icon()),
        );
        assert_eq!(
            provider_runtime_key_for_target("workspace-1", engine, Some(managed_suffix))
                .expect("managed runtime key"),
            format!("{}::workspace-1::{managed_suffix}", engine.icon()),
        );
    }
}

#[test]
fn pi_shared_runtime_key_matches_native_ownership() {
    assert_eq!(
        provider_runtime_key_for_target("workspace-1", EngineType::Pi, None)
            .expect("pi local runtime key"),
        "workspace-1",
    );
    assert_eq!(
        provider_runtime_key_for_target("workspace-1", EngineType::Pi, Some("custom"))
            .expect("pi named runtime key"),
        "workspace-1::pi::custom",
    );
}

#[test]
fn qoder_shared_runtime_key_matches_native_ownership() {
    // Qoder runtime key 必须携带 distribution；Global/CN 可在同一 workspace 并发。
    assert_eq!(
        provider_runtime_key_for_target("workspace-1", EngineType::Qoder, None)
            .expect("qoder Global runtime key"),
        "workspace-1::qoder::global",
    );
    let global_runtime_key = provider_runtime_key_for_target(
        "workspace-1",
        EngineType::Qoder,
        Some(crate::engine::qoder_provider_profile::QODER_GLOBAL_PROVIDER_PROFILE_ID),
    )
    .expect("explicit qoder Global runtime key");
    assert_eq!(global_runtime_key, "workspace-1::qoder::global");
    let cn_runtime_key = provider_runtime_key_for_target(
        "workspace-1",
        EngineType::Qoder,
        Some(crate::engine::qoder_provider_profile::QODER_CN_PROVIDER_PROFILE_ID),
    )
    .expect("qoder CN runtime key");
    assert_eq!(cn_runtime_key, "workspace-1::qoder::cn",);
    assert_ne!(global_runtime_key, cn_runtime_key);
    assert!(provider_runtime_key_for_target(
        "workspace-1",
        EngineType::Qoder,
        Some("unknown-qoder-profile"),
    )
    .is_err());
}

#[test]
fn qoder_runtime_only_catalog_accepts_legacy_and_explicit_distribution_targets() {
    // Qoder 模型目录是 ACP runtime-only：发送路径禁止现场 probe，catalog 不可得
    // 时按空目录 + Allow 放行（Session Switch Catalog Fetch Gate）。
    let legacy_target = ExecutionTargetInput {
        engine: EngineType::Qoder,
        provider_profile_id: None,
        model_catalog_entry_id: Some("qmodel_38max".to_string()),
        model: Some("qmodel_38max".to_string()),
        reasoning_effort: None,
        provider_profile_name_snapshot: Some("本地配置".to_string()),
        provider_profile_source: Some(CanonicalProviderProfileSource::Local),
        runtime_capability_fingerprint: None,
    };
    assert_eq!(
        validate_resolved_execution_target(&legacy_target)
            .expect("qoder runtime-only catalog must not hard-fail"),
        EngineType::Qoder
    );

    let legacy_sentinel = ExecutionTargetInput {
        provider_profile_id: Some(
            crate::engine::qoder_provider_profile::QODER_LOCAL_PROVIDER_PROFILE_ID.to_string(),
        ),
        provider_profile_name_snapshot: Some("Qoder Global".to_string()),
        provider_profile_source: Some(CanonicalProviderProfileSource::Managed),
        ..legacy_target.clone()
    };
    assert_eq!(
        validate_resolved_execution_target(&legacy_sentinel)
            .expect("legacy Qoder sentinel must remain Global-compatible"),
        EngineType::Qoder
    );

    for (provider_profile_id, provider_name) in [
        (
            crate::engine::qoder_provider_profile::QODER_GLOBAL_PROVIDER_PROFILE_ID,
            "Qoder Global",
        ),
        (
            crate::engine::qoder_provider_profile::QODER_CN_PROVIDER_PROFILE_ID,
            "Qoder CN",
        ),
    ] {
        let target = ExecutionTargetInput {
            provider_profile_id: Some(provider_profile_id.to_string()),
            provider_profile_name_snapshot: Some(provider_name.to_string()),
            provider_profile_source: Some(CanonicalProviderProfileSource::Managed),
            ..legacy_target.clone()
        };
        assert_eq!(
            validate_resolved_execution_target(&target)
                .unwrap_or_else(|error| panic!("{provider_name} target rejected: {error}")),
            EngineType::Qoder
        );
    }

    let unknown_target = ExecutionTargetInput {
        provider_profile_id: Some("provider-qoder".to_string()),
        provider_profile_name_snapshot: Some("Unknown Qoder".to_string()),
        provider_profile_source: Some(CanonicalProviderProfileSource::Managed),
        ..legacy_target
    };
    assert!(validate_resolved_execution_target(&unknown_target)
        .expect_err("unknown Qoder profile must fail before Tx1")
        .contains("QODER_DISTRIBUTION"));
}

#[test]
fn collaboration_mode_uses_attempt_model_and_clears_stale_reasoning() {
    let target = ExecutionTargetInput {
        engine: EngineType::Codex,
        provider_profile_id: Some("minimax".to_string()),
        model_catalog_entry_id: Some("minimax-m3".to_string()),
        model: Some("MiniMax-M3".to_string()),
        reasoning_effort: None,
        provider_profile_name_snapshot: Some("MiniMax".to_string()),
        provider_profile_source: Some(CanonicalProviderProfileSource::Managed),
        runtime_capability_fingerprint: None,
    };
    let rewritten = collaboration_mode_for_attempt(
        Some(json!({
            "mode": "default",
            "settings": {
                "model": "gpt-5.6-sol",
                "reasoning_effort": "high",
                "developer_instructions": "keep-me"
            }
        })),
        &target,
    )
    .expect("collaboration mode");

    assert_eq!(
        rewritten.pointer("/settings/model").and_then(Value::as_str),
        Some("MiniMax-M3")
    );
    assert!(rewritten.pointer("/settings/reasoning_effort").is_none());
    assert_eq!(
        rewritten
            .pointer("/settings/developer_instructions")
            .and_then(Value::as_str),
        Some("keep-me")
    );
}

