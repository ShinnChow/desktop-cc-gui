use super::*;
use crate::native_history::{
    ContextSourceEntry, NativeHistoryEngine, NativeHistoryFidelity, NativeHistoryReadResult,
    NativeHistorySource,
};
use crate::shared_context::{compile_native_context, CompileNativeContextRequest};

#[test]
fn codex_projection_preserves_raw_tool_items_and_counts_unimportable_entries() {
    let source = NativeHistorySource {
        session_id: "codex:source".to_string(),
        native_session_id: "source".to_string(),
        engine: NativeHistoryEngine::Codex,
        provider_profile_id: Some("provider-a".to_string()),
    };
    let package = compile_native_context(&CompileNativeContextRequest {
        session_id: source.session_id.clone(),
        binding_key: "continuation:op".to_string(),
        destination: json!({"engine": "codex"}),
        source,
        history: NativeHistoryReadResult {
            reader_id: "codex-rollout-jsonl/v1".to_string(),
            source_fingerprint: "sha256:source".to_string(),
            through_cursor: "jsonl-v1:1:sha256:source".to_string(),
            entries: vec![
                ContextSourceEntry {
                    source_entry_id: "tool".to_string(),
                    occurred_at: None,
                    role: "tool".to_string(),
                    blocks: vec![json!({
                        "kind": "native-block",
                        "value": {
                            "type": "function_call",
                            "name": "shell",
                            "arguments": "{}",
                            "call_id": "call-1"
                        }
                    })],
                    provenance: json!({}),
                    fidelity: NativeHistoryFidelity::Semantic,
                },
                ContextSourceEntry {
                    source_entry_id: "control".to_string(),
                    occurred_at: None,
                    role: "control".to_string(),
                    blocks: vec![json!({"kind": "native-block", "value": {"type": "unknown"}})],
                    provenance: json!({}),
                    fidelity: NativeHistoryFidelity::Lossy,
                },
            ],
            fidelity: NativeHistoryFidelity::Semantic,
            omissions: Vec::new(),
        },
        capabilities: RuntimeContextCapabilities {
            native_delta: false,
            structured_history_import: true,
            native_clone: false,
            user_channel_transcript: true,
            tool_history: true,
            image_history: false,
            strong_context_ack: true,
        },
        budget_estimated_tokens: None,
    })
    .expect("compile");

    let (items, dropped) = codex_import_projection(&package);
    assert_eq!(items[0]["role"], "user");
    assert!(items[0]["content"][0]["text"]
        .as_str()
        .is_some_and(|text| text.starts_with("MOSSX_CONTEXT_PACKAGE:")));
    assert_eq!(items[1]["type"], "function_call");
    let package_marker = items[0]["content"][0]["text"]
        .as_str()
        .expect("package marker");
    let accepted_marker = items
        .last()
        .and_then(|item| item["content"][0]["text"].as_str())
        .expect("accepted marker");
    assert_eq!(
        accepted_marker,
        package_marker.replacen("MOSSX_CONTEXT_PACKAGE:", "MOSSX_CONTEXT_ACCEPTED:", 1)
    );
    assert_eq!(dropped, 1);
    assert!(
        items
            .iter()
            .all(|item| item.get("role").and_then(Value::as_str) != Some("control")),
        "control roles must not be injected as messages"
    );
}

#[test]
fn codex_import_projection_drops_control_role_text_messages() {
    // DeepSeek 等兼容 API：unknown variant `control`，只认 user/assistant/system/developer。
    let source = NativeHistorySource {
        session_id: "codex:source".to_string(),
        native_session_id: "source".to_string(),
        engine: NativeHistoryEngine::Codex,
        provider_profile_id: Some("provider-a".to_string()),
    };
    let package = compile_native_context(&CompileNativeContextRequest {
        session_id: source.session_id.clone(),
        binding_key: "continuation:op".to_string(),
        destination: json!({"engine": "codex"}),
        source,
        history: NativeHistoryReadResult {
            reader_id: "codex-rollout-jsonl/v1".to_string(),
            source_fingerprint: "sha256:source".to_string(),
            through_cursor: "jsonl-v1:2:sha256:source".to_string(),
            entries: vec![
                ContextSourceEntry {
                    source_entry_id: "u1".to_string(),
                    occurred_at: None,
                    role: "user".to_string(),
                    blocks: vec![json!({"kind": "text", "text": "hello from user"})],
                    provenance: json!({}),
                    fidelity: NativeHistoryFidelity::Semantic,
                },
                ContextSourceEntry {
                    source_entry_id: "control-meta".to_string(),
                    occurred_at: None,
                    role: "control".to_string(),
                    blocks: vec![json!({
                        "kind": "text",
                        "text": "session meta that must not become a control message"
                    })],
                    provenance: json!({}),
                    fidelity: NativeHistoryFidelity::Lossy,
                },
                ContextSourceEntry {
                    source_entry_id: "a1".to_string(),
                    occurred_at: None,
                    role: "assistant".to_string(),
                    blocks: vec![json!({"kind": "text", "text": "hello from assistant"})],
                    provenance: json!({}),
                    fidelity: NativeHistoryFidelity::Semantic,
                },
            ],
            fidelity: NativeHistoryFidelity::Semantic,
            omissions: Vec::new(),
        },
        capabilities: RuntimeContextCapabilities {
            native_delta: false,
            structured_history_import: true,
            native_clone: false,
            user_channel_transcript: true,
            tool_history: true,
            image_history: false,
            strong_context_ack: true,
        },
        budget_estimated_tokens: None,
    })
    .expect("compile");

    let (items, dropped) = codex_import_projection(&package);
    let roles: Vec<&str> = items
        .iter()
        .filter_map(|item| item.get("role").and_then(Value::as_str))
        .collect();
    assert!(roles.contains(&"user"));
    assert!(roles.contains(&"assistant"));
    assert!(
        !roles.iter().any(|role| *role == "control"),
        "control text must be dropped, got roles={roles:?}"
    );
    assert!(
        dropped >= 1,
        "control entry should count as dropped, dropped={dropped}"
    );
    assert!(
        items.iter().any(|item| {
            item.get("role") == Some(&json!("user"))
                && item["content"][0]["text"]
                    .as_str()
                    .is_some_and(|text| text.contains("hello from user"))
        }),
        "user text preserved"
    );
    assert!(
        items.iter().any(|item| {
            item.get("role") == Some(&json!("assistant"))
                && item["content"][0]["text"]
                    .as_str()
                    .is_some_and(|text| text.contains("hello from assistant"))
        }),
        "assistant text preserved"
    );
}

#[test]
fn codex_zero_delta_projection_does_not_create_marker_only_import() {
    let source = NativeHistorySource {
        session_id: "codex:source".to_string(),
        native_session_id: "source".to_string(),
        engine: NativeHistoryEngine::Codex,
        provider_profile_id: Some("provider-a".to_string()),
    };
    // 编译器对空 history fail-closed（d528fc91c），因此用一条有效 entry 编译、
    // 再清空 delta 来构造 zero-transfer 包，守住「空 delta 不产 marker-only 导入」。
    let mut package = compile_native_context(&CompileNativeContextRequest {
        session_id: source.session_id.clone(),
        binding_key: "continuation:op".to_string(),
        destination: json!({"engine": "codex"}),
        source,
        history: NativeHistoryReadResult {
            reader_id: "codex-rollout-jsonl/v1".to_string(),
            source_fingerprint: "sha256:source".to_string(),
            through_cursor: "jsonl-v1:1:sha256:source".to_string(),
            entries: vec![ContextSourceEntry {
                source_entry_id: "user-1".to_string(),
                occurred_at: None,
                role: "user".to_string(),
                blocks: vec![json!({"text": "hello"})],
                provenance: json!({}),
                fidelity: NativeHistoryFidelity::Semantic,
            }],
            fidelity: NativeHistoryFidelity::Semantic,
            omissions: Vec::new(),
        },
        capabilities: RuntimeContextCapabilities {
            native_delta: false,
            structured_history_import: true,
            native_clone: false,
            user_channel_transcript: true,
            tool_history: true,
            image_history: false,
            strong_context_ack: true,
        },
        budget_estimated_tokens: None,
    })
    .expect("compile projection package");
    package.delta.clear();

    let (items, dropped) = codex_import_projection(&package);
    assert!(items.is_empty());
    assert_eq!(dropped, 0);
}

