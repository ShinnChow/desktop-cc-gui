use super::*;
use crate::shared_event_log::{open, OpenOutcome};

fn durable_owner_for_receipt_test(
    engine: EngineType,
    provider_profile_id: Option<&str>,
    model: &str,
    reasoning_effort: Option<&str>,
) -> DurableAttemptOwner {
    let root = std::env::temp_dir().join(format!(
        "mossx-shared-dispatch-receipt-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).expect("create receipt test root");
    let writer = match open(&root.join("shared-events.db")).expect("open receipt test store") {
        OpenOutcome::Ready(writer) => writer,
        OpenOutcome::ReadOnlyRecovery { reason, .. } => {
            panic!("unexpected receipt test recovery store: {reason}")
        }
    };
    let attempt_id = "attempt-receipt";
    writer
        .append_canonical_fact(
            "receipt-session".to_string(),
            CanonicalFact::TurnRequested(TurnRequestedFact {
                logical_turn_id: "logical-receipt".to_string(),
                attempt_id: attempt_id.to_string(),
                retry_of_attempt_id: None,
                input: CanonicalUserInput {
                    text: Some("hello".to_string()),
                    image_refs: None,
                    attachment_refs: None,
                    extra: Value::Object(Default::default()),
                },
                target: TurnExecutionSnapshot {
                    engine: engine.icon().to_string(),
                    provider_profile_id: provider_profile_id.map(str::to_string),
                    model_catalog_entry_id: Some(model.to_string()),
                    model: Some(model.to_string()),
                    reasoning: reasoning_effort.map(|effort| ReasoningSelection {
                        effort: effort.to_string(),
                        extra: Value::Object(Default::default()),
                    }),
                    provider_profile_name_snapshot: Some(
                        provider_profile_id.unwrap_or("本地配置").to_string(),
                    ),
                    provider_profile_source: Some(if provider_profile_id.is_some() {
                        CanonicalProviderProfileSource::Managed
                    } else {
                        CanonicalProviderProfileSource::Local
                    }),
                    runtime_capability_fingerprint: None,
                    extra: Value::Object(Default::default()),
                },
                requested_at: 1,
                extra: Value::Object(Default::default()),
            }),
        )
        .expect("append receipt owner");
    let owner =
        durable_attempt_owner(&writer, "receipt-session", attempt_id).expect("durable owner");
    writer.shutdown().expect("shutdown receipt test writer");
    std::fs::remove_dir_all(root).expect("remove receipt test root");
    owner
}

#[test]
fn managed_codex_receipt_requires_exact_provider_runtime_key() {
    let owner = durable_owner_for_receipt_test(
        EngineType::Codex,
        Some("provider-kimi"),
        "kimi-for-coding",
        Some("high"),
    );
    let workspace_id = "workspace-managed";
    let expected_runtime_key = crate::shared::codex_core::session_key_for_provider(
        workspace_id,
        Some("provider-kimi"),
    );
    let receipt = json!({
        "mossxDispatchReceipt": {
            "engine": "codex",
            "providerProfileId": "provider-kimi",
            "providerProfileSource": "managed",
            "providerRuntimeKey": expected_runtime_key,
            "model": "kimi-for-coding",
            "reasoningEffort": "high",
        }
    });

    assert!(validate_runtime_dispatch_receipt(&receipt, &owner, workspace_id).is_ok());

    let mut poisoned = receipt;
    poisoned["mossxDispatchReceipt"]["providerRuntimeKey"] =
        Value::String("workspace-managed::different-provider".to_string());
    assert!(
        validate_runtime_dispatch_receipt(&poisoned, &owner, workspace_id)
            .expect_err("wrong Runtime owner must fail closed")
            .contains("Runtime key does not match")
    );
}

#[test]
fn claude_receipt_accepts_local_and_managed_provider_identity() {
    let local_owner =
        durable_owner_for_receipt_test(EngineType::Claude, None, "claude-sonnet-4-5", None);
    let local_receipt = json!({
        "mossxDispatchReceipt": {
            "engine": "claude",
            "providerProfileId": null,
            "providerProfileSource": "local",
            "providerRuntimeKey": format!(
                "claude::workspace-local::{}",
                crate::engine::claude::CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
            ),
            "model": "claude-sonnet-4-5",
            "reasoningEffort": null,
        }
    });
    assert!(
        validate_runtime_dispatch_receipt(&local_receipt, &local_owner, "workspace-local",)
            .is_ok()
    );
    let mut wrong_local_runtime = local_receipt;
    wrong_local_runtime["mossxDispatchReceipt"]["providerRuntimeKey"] =
        json!("claude::workspace-local::provider-anthropic");
    assert!(validate_runtime_dispatch_receipt(
        &wrong_local_runtime,
        &local_owner,
        "workspace-local",
    )
    .is_err());

    let managed_owner = durable_owner_for_receipt_test(
        EngineType::Claude,
        Some("provider-anthropic"),
        "claude-opus-4-1",
        Some("high"),
    );
    assert!(validate_runtime_dispatch_receipt(
        &json!({
            "mossxDispatchReceipt": {
                "engine": "claude",
                "providerProfileId": "provider-anthropic",
                "providerProfileSource": "managed",
                "providerRuntimeKey": "claude::workspace-managed::provider-anthropic",
                "model": "claude-opus-4-1",
                "reasoningEffort": "high",
            }
        }),
        &managed_owner,
        "workspace-managed",
    )
    .is_ok());
}

#[test]
fn newly_supported_engine_receipts_accept_local_and_managed_identity() {
    for (engine, model, managed_provider) in [
        (EngineType::Kimi, "kimi-k2", "provider-kimi"),
        (EngineType::Grok, "grok-code-fast-1", "provider-grok"),
        (
            EngineType::OpenCode,
            "ccgui/opencode-model",
            "provider-opencode",
        ),
    ] {
        let local_owner = durable_owner_for_receipt_test(engine, None, model, None);
        let local_runtime_key =
            provider_runtime_key_for_target("workspace-local", engine, None)
                .expect("local runtime key");
        assert!(validate_runtime_dispatch_receipt(
            &json!({
                "mossxDispatchReceipt": {
                    "engine": engine.icon(),
                    "providerProfileId": null,
                    "providerProfileSource": "local",
                    "providerRuntimeKey": local_runtime_key,
                    "model": model,
                    "reasoningEffort": null,
                }
            }),
            &local_owner,
            "workspace-local",
        )
        .is_ok());

        let managed_owner =
            durable_owner_for_receipt_test(engine, Some(managed_provider), model, Some("high"));
        let managed_runtime_key = provider_runtime_key_for_target(
            "workspace-managed",
            engine,
            Some(managed_provider),
        )
        .expect("managed runtime key");
        assert!(validate_runtime_dispatch_receipt(
            &json!({
                "mossxDispatchReceipt": {
                    "engine": engine.icon(),
                    "providerProfileId": managed_provider,
                    "providerProfileSource": "managed",
                    "providerRuntimeKey": managed_runtime_key,
                    "model": model,
                    "reasoningEffort": "high",
                }
            }),
            &managed_owner,
            "workspace-managed",
        )
        .is_ok());
    }
}

#[test]
fn qoder_receipts_preserve_legacy_global_and_isolate_distributions() {
    let model = "qmodel_38max";
    let workspace_id = "workspace-qoder";

    let legacy_owner = durable_owner_for_receipt_test(EngineType::Qoder, None, model, None);
    let legacy_runtime_key =
        provider_runtime_key_for_target(workspace_id, EngineType::Qoder, None)
            .expect("legacy Qoder Global runtime key");
    assert!(validate_runtime_dispatch_receipt(
        &json!({
            "mossxDispatchReceipt": {
                "engine": "qoder",
                "providerProfileId": null,
                "providerProfileSource": "local",
                "providerRuntimeKey": legacy_runtime_key,
                "model": model,
                "reasoningEffort": null,
            }
        }),
        &legacy_owner,
        workspace_id,
    )
    .is_ok());

    let global_profile_id =
        crate::engine::qoder_provider_profile::QODER_GLOBAL_PROVIDER_PROFILE_ID;
    let cn_profile_id = crate::engine::qoder_provider_profile::QODER_CN_PROVIDER_PROFILE_ID;
    let global_owner = durable_owner_for_receipt_test(
        EngineType::Qoder,
        Some(global_profile_id),
        model,
        Some("high"),
    );
    let global_runtime_key = provider_runtime_key_for_target(
        workspace_id,
        EngineType::Qoder,
        Some(global_profile_id),
    )
    .expect("Qoder Global runtime key");
    let cn_runtime_key =
        provider_runtime_key_for_target(workspace_id, EngineType::Qoder, Some(cn_profile_id))
            .expect("Qoder CN runtime key");
    assert_ne!(global_runtime_key, cn_runtime_key);

    let global_receipt = json!({
        "mossxDispatchReceipt": {
            "engine": "qoder",
            "providerProfileId": global_profile_id,
            "providerProfileSource": "managed",
            "providerRuntimeKey": global_runtime_key,
            "model": model,
            "reasoningEffort": "high",
        }
    });
    assert!(
        validate_runtime_dispatch_receipt(&global_receipt, &global_owner, workspace_id).is_ok()
    );

    let cn_owner = durable_owner_for_receipt_test(
        EngineType::Qoder,
        Some(cn_profile_id),
        model,
        Some("high"),
    );
    let cn_receipt = json!({
        "mossxDispatchReceipt": {
            "engine": "qoder",
            "providerProfileId": cn_profile_id,
            "providerProfileSource": "managed",
            "providerRuntimeKey": cn_runtime_key,
            "model": model,
            "reasoningEffort": "high",
        }
    });
    assert!(validate_runtime_dispatch_receipt(&cn_receipt, &cn_owner, workspace_id).is_ok());

    let mut cross_distribution_receipt = global_receipt;
    cross_distribution_receipt["mossxDispatchReceipt"]["providerRuntimeKey"] =
        json!(cn_runtime_key);
    assert!(validate_runtime_dispatch_receipt(
        &cross_distribution_receipt,
        &global_owner,
        workspace_id,
    )
    .expect_err("Qoder CN runtime key must not satisfy a Global receipt")
    .contains("Runtime key does not match"));
}

#[test]
fn dispatch_receipt_missing_or_mismatched_identity_fails_closed() {
    let owner = durable_owner_for_receipt_test(
        EngineType::Codex,
        Some("provider-kimi"),
        "kimi-for-coding",
        Some("high"),
    );
    let workspace_id = "workspace-managed";
    let expected_runtime_key = crate::shared::codex_core::session_key_for_provider(
        workspace_id,
        Some("provider-kimi"),
    );
    let valid_receipt = json!({
        "mossxDispatchReceipt": {
            "engine": "codex",
            "providerProfileId": "provider-kimi",
            "providerProfileSource": "managed",
            "providerRuntimeKey": expected_runtime_key,
            "model": "kimi-for-coding",
            "reasoningEffort": "high",
        }
    });

    assert!(
        validate_runtime_dispatch_receipt(&json!({}), &owner, workspace_id)
            .expect_err("missing receipt must fail closed")
            .contains("receipt is missing")
    );

    for (field, poisoned_value) in [
        ("engine", json!("claude")),
        ("providerProfileId", json!("provider-other")),
        ("providerProfileSource", json!("local")),
        ("model", json!("gpt-5.3-codex-spark")),
        ("reasoningEffort", json!("low")),
        ("providerRuntimeKey", Value::Null),
    ] {
        let mut poisoned = valid_receipt.clone();
        poisoned["mossxDispatchReceipt"][field] = poisoned_value;
        assert!(
            validate_runtime_dispatch_receipt(&poisoned, &owner, workspace_id).is_err(),
            "{field} mismatch must fail closed"
        );
    }

    let mut missing_model = valid_receipt;
    missing_model["mossxDispatchReceipt"]
        .as_object_mut()
        .expect("receipt object")
        .remove("model");
    assert!(
        validate_runtime_dispatch_receipt(&missing_model, &owner, workspace_id)
            .expect_err("missing field must fail closed")
            .contains("missing model")
    );
}

