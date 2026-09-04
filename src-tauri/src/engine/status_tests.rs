use super::*;
use crate::engine::qoder_provider_profile::{
    QoderDistribution, QODER_CN_PROVIDER_PROFILE_ID, QODER_GLOBAL_PROVIDER_PROFILE_ID,
};
use serde_json::json;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[test]
fn qoder_catalog_rows_keep_the_requested_distribution_profile() {
    let models = vec![ModelInfo::new("qoder-model", "Qoder model")];
    let global = scope_qoder_models_to_distribution(QoderDistribution::Global, models.clone());
    let cn = scope_qoder_models_to_distribution(QoderDistribution::Cn, models);

    assert_eq!(
        global[0].provider_profile_id.as_deref(),
        Some(QODER_GLOBAL_PROVIDER_PROFILE_ID)
    );
    assert_eq!(
        cn[0].provider_profile_id.as_deref(),
        Some(QODER_CN_PROVIDER_PROFILE_ID)
    );
}

#[test]
fn parse_pi_models_output_keeps_thinking_vision_and_default() {
    let models = parse_pi_models_output(
        "provider model          ctx  max     thinking images
openai   gpt-5.2        400k  128k    yes      yes
anthropic claude-opus    200k   32k    no       yes
",
    );
    assert_eq!(models.len(), 2);
    assert_eq!(models[0].id, "openai/gpt-5.2");
    assert!(models[0].default);
    assert_eq!(models[0].description, "ctx 400k · thinking · vision");
    assert_eq!(
        models[0].supported_reasoning_efforts,
        vec!["off", "minimal", "low", "medium", "high"]
    );
    assert_eq!(models[1].id, "anthropic/claude-opus");
    assert!(!models[1].default);
    assert_eq!(models[1].description, "ctx 200k · vision");
    assert!(models[1].supported_reasoning_efforts.is_empty());
}

#[test]
fn supported_thinking_levels_follow_pi_map_rules() {
    assert!(supported_thinking_levels_for_pi_model(false, None).is_empty());
    assert_eq!(
        supported_thinking_levels_for_pi_model(true, None),
        vec!["off", "minimal", "low", "medium", "high"]
    );
    let map = json!({
        "off": null,
        "minimal": null,
        "low": null,
        "medium": null,
        "high": "high",
        "xhigh": null,
        "max": "max"
    });
    assert_eq!(
        supported_thinking_levels_for_pi_model(true, Some(&map)),
        vec!["high", "max"]
    );
}

fn write_pi_settings_for_test(home: &Path, content: &str) {
    fs::create_dir_all(home).expect("create pi home dir");
    fs::write(home.join("settings.json"), content).expect("write settings.json");
}

fn pi_test_home(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!("ccgui-pi-default-{label}-{}", uuid::Uuid::new_v4()))
}

#[test]
fn read_pi_default_model_selection_parses_settings_fields() {
    let home = pi_test_home("full");
    write_pi_settings_for_test(
        &home,
        r#"{"theme":"dark","defaultProvider":"kimi-coding","defaultModel":"k3"}"#,
    );
    assert_eq!(
        read_pi_default_model_selection(Some(&home)),
        Some((Some("kimi-coding".to_string()), "k3".to_string()))
    );
}

#[test]
fn read_pi_default_model_selection_allows_missing_provider() {
    let home = pi_test_home("providerless");
    write_pi_settings_for_test(&home, r#"{"defaultModel":" my-relay/grok-4.6 "}"#);
    assert_eq!(
        read_pi_default_model_selection(Some(&home)),
        Some((None, "my-relay/grok-4.6".to_string()))
    );
}

#[test]
fn read_pi_default_model_selection_tolerates_missing_or_broken_settings() {
    assert_eq!(read_pi_default_model_selection(None), None);

    let missing = pi_test_home("missing");
    assert_eq!(read_pi_default_model_selection(Some(&missing)), None);

    let broken = pi_test_home("broken");
    write_pi_settings_for_test(&broken, "{ not json");
    assert_eq!(read_pi_default_model_selection(Some(&broken)), None);

    let blank = pi_test_home("blank");
    write_pi_settings_for_test(&blank, r#"{"defaultProvider":"","defaultModel":"  "}"#);
    assert_eq!(read_pi_default_model_selection(Some(&blank)), None);

    let non_string = pi_test_home("non-string");
    write_pi_settings_for_test(&non_string, r#"{"defaultModel":3}"#);
    assert_eq!(read_pi_default_model_selection(Some(&non_string)), None);
}

#[test]
fn promote_default_model_moves_match_to_front_and_clears_old_flag() {
    let mut models = vec![
        ModelInfo::new("anthropic/claude-fable-5", "anthropic/claude-fable-5").as_default(),
        ModelInfo::new("kimi-coding/k3", "kimi-coding/k3"),
        ModelInfo::new("deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-pro"),
    ];
    assert!(promote_default_model(&mut models, "kimi-coding/k3"));
    assert_eq!(models[0].id, "kimi-coding/k3");
    assert!(models[0].default);
    assert!(!models[1].default);
    assert!(!models[2].default);
}

#[test]
fn promote_default_model_leaves_list_untouched_on_miss() {
    let mut models = vec![
        ModelInfo::new("anthropic/claude-fable-5", "anthropic/claude-fable-5").as_default(),
        ModelInfo::new("kimi-coding/k3", "kimi-coding/k3"),
    ];
    assert!(!promote_default_model(&mut models, "openai/gpt-5"));
    assert!(models[0].default);
    assert!(!models[1].default);
    assert_eq!(models[0].id, "anthropic/claude-fable-5");
}

#[test]
fn pi_default_candidate_ids_prefer_provider_prefixed_then_bare() {
    assert_eq!(
        pi_default_candidate_ids(Some("kimi-coding"), "k3"),
        vec!["kimi-coding/k3".to_string(), "k3".to_string()]
    );
    assert_eq!(
        pi_default_candidate_ids(None, "my-relay/grok-4.6"),
        vec!["my-relay/grok-4.6".to_string()]
    );
    assert_eq!(
        pi_default_candidate_ids(Some("  "), "k3"),
        vec!["k3".to_string()]
    );
}

#[test]
fn pi_default_promotion_end_to_end_over_parsed_catalog() {
    // 复刻「settings default 指向 catalog 存在条目」的完整汇合语义：
    // parse 层 first-entry default 被清除，settings default 置顶。
    let mut models = parse_pi_models_output(
        "provider model          ctx  max     thinking images
anthropic claude-fable-5  1M   128K    yes      yes
kimi-coding k3             1.0M 131.1K  yes      yes
",
    );
    for candidate in pi_default_candidate_ids(Some("kimi-coding"), "k3") {
        if promote_default_model(&mut models, &candidate) {
            break;
        }
    }
    assert_eq!(models[0].id, "kimi-coding/k3");
    assert!(models[0].default);
    assert!(!models[1].default);
}

/// 探测 spawn 参数必须同时跳过会话恢复与 extension boot：任一缺失都会
/// 把探测推回 ~10s 量级（2026-08-26 实证）。预算同时钉在 15s 兜底：
/// 改动任一常量都必须是显式决策（同步更新 OpenSpec 提案设计）。
#[test]
fn pi_catalog_probe_rpc_args_skip_session_and_extension_boot() {
    let args: Vec<&str> = PI_CATALOG_PROBE_RPC_ARGS.split_whitespace().collect();
    assert_eq!(args, vec!["--no-session", "--no-extensions"]);
    assert_eq!(PI_CATALOG_PROBE_TIMEOUT, Duration::from_secs(15));
}

#[test]
fn parse_pi_available_models_projects_thinking_levels() {
    let models = parse_pi_available_models(&json!({
        "models": [
            {
                "id": "gpt-5.2",
                "name": "GPT-5.2",
                "provider": "openai",
                "reasoning": true,
                "input": ["text", "image"],
                "contextWindow": 400000,
                "thinkingLevelMap": {
                    "off": null,
                    "minimal": "low",
                    "xhigh": "xhigh"
                }
            },
            {
                "id": "gpt-4.1",
                "provider": "openai",
                "reasoning": false,
                "input": ["text"]
            }
        ]
    }));
    assert_eq!(models.len(), 2);
    assert_eq!(models[0].id, "openai/gpt-5.2");
    assert!(models[0].default);
    assert_eq!(
        models[0].supported_reasoning_efforts,
        vec!["minimal", "low", "medium", "high", "xhigh"]
    );
    assert_eq!(models[1].id, "openai/gpt-4.1");
    assert!(models[1].supported_reasoning_efforts.is_empty());
}

#[test]
fn custom_relay_reasoning_model_without_map_uses_pi_default_five_levels() {
    // models.json: { id, reasoning: true } and no thinkingLevelMap.
    // Screenshot collision: my-relay/grok-4.6 shows Off/Minimal/Low/Medium/High.
    let models = parse_pi_available_models(&json!({
        "models": [{
            "id": "grok-4.6",
            "name": "Grok 4.6",
            "provider": "my-relay",
            "reasoning": true,
            "input": ["text", "image"]
        }]
    }));
    assert_eq!(models[0].id, "my-relay/grok-4.6");
    assert_eq!(
        models[0].supported_reasoning_efforts,
        vec!["off", "minimal", "low", "medium", "high"]
    );
    assert_eq!(
        models[0].provenance.as_deref(),
        Some("cli:pi-available-models")
    );
}

#[test]
fn official_grok_thinking_map_hides_off_minimal_and_extended_levels() {
    let map = json!({
        "off": null,
        "minimal": null,
        "low": "low",
        "medium": "medium",
        "high": "high"
    });
    assert_eq!(
        supported_thinking_levels_for_pi_model(true, Some(&map)),
        vec!["low", "medium", "high"]
    );
    let models = parse_pi_available_models(&json!({
        "models": [{
            "id": "grok-4.5",
            "provider": "xai",
            "reasoning": true,
            "thinkingLevelMap": {
                "off": null,
                "minimal": null,
                "low": "low",
                "medium": "medium",
                "high": "high"
            }
        }]
    }));
    assert_eq!(
        models[0].supported_reasoning_efforts,
        vec!["low", "medium", "high"]
    );
}

#[test]
fn list_models_thinking_yes_over_approximates_official_grok_allowlist() {
    let models = parse_pi_models_output(
        "provider model          ctx  max     thinking images
xai      grok-4.5        256k   64k    yes      yes
",
    );
    assert_eq!(models[0].id, "xai/grok-4.5");
    assert_eq!(models[0].provenance.as_deref(), Some("cli:pi-list-models"));
    assert_eq!(
        models[0].supported_reasoning_efforts,
        vec!["off", "minimal", "low", "medium", "high"]
    );
}

#[test]
fn parse_pi_models_output_keeps_cjk_and_mixed_provider_rows() {
    let models = parse_pi_models_output(
        "provider  model          ctx   max  thinking images
智谱      glm-5.2         200k  64k  yes      no
123nhh-gpt gpt-5.6-sol   256k  64k  no       no
",
    );
    let cjk = models
        .iter()
        .find(|m| m.id == "智谱/glm-5.2")
        .expect("CJK provider row must survive parsing");
    assert_eq!(cjk.provider.as_deref(), Some("智谱"));
    assert!(models.iter().any(|m| m.id == "123nhh-gpt/gpt-5.6-sol"));
}

#[test]
fn parse_pi_models_output_falls_back_to_auto_when_table_is_empty() {
    let models = parse_pi_models_output("provider model ctx max thinking images\n");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "auto");
    assert!(models[0].default);
    assert_eq!(models[0].source, "fallback");
}

#[test]
fn model_catalog_pair_separates_selection_id_from_runtime_model() {
    let catalog =
        vec![ModelInfo::new("settings-reasoning", "Reasoning")
            .with_runtime_model("deepseek-v4-pro")];

    assert!(validate_model_catalog_pair(
        Some("settings-reasoning"),
        Some("deepseek-v4-pro"),
        &catalog,
        UnlistedRuntimeModelPolicy::Reject,
    )
    .is_ok());
    assert!(validate_model_catalog_pair(
        Some("settings-reasoning"),
        Some("settings-reasoning"),
        &catalog,
        UnlistedRuntimeModelPolicy::Reject,
    )
    .expect_err("catalog id must not become the runtime model")
    .contains("requires runtime model 'deepseek-v4-pro'"));
    assert!(validate_model_catalog_pair(
        None,
        Some("settings-reasoning"),
        &catalog,
        UnlistedRuntimeModelPolicy::Reject,
    )
    .expect_err("legacy target must not treat a catalog id as runtime")
    .contains("is a catalog entry id"));
}

#[test]
fn unlisted_runtime_policy_allow_accepts_custom_model_names() {
    let catalog = vec![ModelInfo::new("known", "Known")];

    assert!(validate_model_catalog_pair(
        None,
        Some("custom/provider-model"),
        &catalog,
        UnlistedRuntimeModelPolicy::Allow,
    )
    .is_ok());
    // 自定义 catalog entry id：Allow 不拦截用户模型名
    assert!(validate_model_catalog_pair(
        Some("gpt-5.3-codex-spark"),
        Some("gpt-5.3-codex-spark"),
        &catalog,
        UnlistedRuntimeModelPolicy::Allow,
    )
    .is_ok());
    assert!(validate_model_catalog_pair(
        None,
        Some("custom/provider-model"),
        &catalog,
        UnlistedRuntimeModelPolicy::Reject,
    )
    .expect_err("Reject still fail-closes unknown runtime models")
    .contains("runtime model 'custom/provider-model' is unavailable"));
    assert!(validate_model_catalog_pair(
        Some("gpt-5.3-codex-spark"),
        Some("gpt-5.3-codex-spark"),
        &catalog,
        UnlistedRuntimeModelPolicy::Reject,
    )
    .expect_err("Reject still fail-closes unknown catalog entries")
    .contains("catalog entry 'gpt-5.3-codex-spark' is unavailable"));
}

#[test]
fn shared_local_validation_catalog_covers_all_supported_cli_engines() {
    for engine in [
        EngineType::Claude,
        EngineType::Codex,
        EngineType::Kimi,
        EngineType::Grok,
        EngineType::OpenCode,
    ] {
        let catalog = get_local_engine_models_for_validation(engine)
            .unwrap_or_else(|| panic!("missing local validation catalog for {engine:?}"));
        let selected = catalog
            .first()
            .unwrap_or_else(|| panic!("empty local validation catalog for {engine:?}"));

        assert!(
            validate_model_catalog_pair(
                Some(&selected.id),
                Some(&selected.model),
                &catalog,
                UnlistedRuntimeModelPolicy::Reject,
            )
            .is_ok(),
            "{engine:?}"
        );
    }
    assert!(get_local_engine_models_for_validation(EngineType::Gemini).is_none());
}

#[test]
fn claude_settings_overrides_rewrite_builtin_tier_runtime_models() {
    let mut models = get_builtin_claude_models();
    apply_claude_model_overrides(
        &mut models,
        ClaudeModelOverrides {
            main: Some("MiniMax-M1[1m]".to_string()),
            fable: Some("kimi-k3".to_string()),
            sonnet: Some("GLM-5.1".to_string()),
            opus: Some("MiniMax-M4[1m]".to_string()),
            haiku: Some("deepseek-v4-flash".to_string()),
            ..ClaudeModelOverrides::default()
        },
    );
    // Tier ids stay stable; runtime model + display name are rewritten.
    let fable = models.iter().find(|m| m.id == "claude-fable-5").unwrap();
    assert_eq!(fable.model, "kimi-k3");
    assert_eq!(fable.name, "kimi-k3");
    assert!(fable.description.contains("Fable 5"));

    let opus = models.iter().find(|m| m.id == "claude-opus-5").unwrap();
    assert_eq!(opus.model, "MiniMax-M4[1m]");
    assert_eq!(opus.name, "MiniMax-M4[1m]");

    let sonnet = models.iter().find(|m| m.id == "claude-sonnet-5").unwrap();
    assert_eq!(sonnet.model, "GLM-5.1");
    assert_eq!(sonnet.name, "GLM-5.1");

    let haiku = models
        .iter()
        .find(|m| m.id == "claude-haiku-4-5-20251001")
        .unwrap();
    assert_eq!(haiku.model, "deepseek-v4-flash");
    assert_eq!(haiku.name, "deepseek-v4-flash");

    // No synthetic settings-* catalog rows.
    assert!(!models.iter().any(|model| model.id.starts_with("settings-")));
    assert_eq!(models.len(), 4);
}

#[tokio::test]
async fn claude_models_include_builtin_catalog() {
    let models = get_claude_models("claude", None).await;
    // Builtin tier catalog ids always remain, even when settings rewrite the
    // runtime model (e.g. all tiers → kimi-k3).
    for catalog_id in [
        "claude-opus-5",
        "claude-fable-5",
        "claude-sonnet-5",
        "claude-haiku-4-5-20251001",
    ] {
        assert!(
            models.iter().any(|model| model.id == catalog_id),
            "missing builtin catalog id {catalog_id}"
        );
    }
    // Bare help aliases are still not synthesized as catalog entries.
    assert!(!models.iter().any(|model| model.id == "sonnet"));
    assert!(!models.iter().any(|model| model.id == "opus"));
    assert!(!models.iter().any(|model| model.id == "haiku"));
    assert_eq!(models.iter().filter(|model| model.default).count(), 1);
}

#[test]
fn claude_settings_overrides_map_all_tiers_to_same_runtime_without_collapse() {
    let mut models = get_builtin_claude_models();
    apply_claude_model_overrides(
        &mut models,
        ClaudeModelOverrides {
            fable: Some("kimi-k3".to_string()),
            sonnet: Some("kimi-k3".to_string()),
            opus: Some("kimi-k3".to_string()),
            haiku: Some("kimi-k3".to_string()),
            ..ClaudeModelOverrides::default()
        },
    );
    ensure_default_model(&mut models);
    let models = dedupe_models_preserve_order(models);

    // All four tiers remain visible even when they share the same runtime model.
    assert_eq!(models.len(), 4);
    assert!(models.iter().all(|model| model.model == "kimi-k3"));
    assert!(models.iter().all(|model| model.name == "kimi-k3"));
    assert!(models.iter().any(|model| model.id == "claude-fable-5"));
    assert!(models.iter().any(|model| model.id == "claude-opus-5"));
    assert!(models.iter().any(|model| model.id == "claude-sonnet-5"));
    assert!(models
        .iter()
        .any(|model| model.id == "claude-haiku-4-5-20251001"));
    // Tier descriptions are preserved for the subtitle row.
    assert!(models
        .iter()
        .find(|model| model.id == "claude-fable-5")
        .unwrap()
        .description
        .contains("Mythos"));
}

#[test]
fn claude_builtin_catalog_defaults_to_opus() {
    let mut models = get_builtin_claude_models();
    apply_claude_model_overrides(&mut models, ClaudeModelOverrides::default());
    ensure_default_model(&mut models);
    let models = dedupe_models_preserve_order(models);

    assert_eq!(models.len(), 4);
    assert!(models
        .iter()
        .all(|model| model.provider.as_deref() == Some("anthropic")));
    assert!(models.iter().all(|model| model.source == "builtin"));
    let default_model = models.iter().find(|model| model.default).unwrap();
    assert_eq!(default_model.id, "claude-opus-5");
    assert_eq!(default_model.name, "Opus 5");
}

#[test]
fn claude_model_dedupe_uses_catalog_id() {
    // Same catalog id collapses.
    let same_id = dedupe_models_preserve_order(vec![
        ModelInfo::new("cli-sonnet", "Sonnet")
            .with_runtime_model("sonnet")
            .with_source("cli-discovered"),
        ModelInfo::new("cli-sonnet", "Fallback Sonnet")
            .with_runtime_model("sonnet")
            .with_source("builtin-fallback"),
    ]);
    assert_eq!(same_id.len(), 1);
    assert_eq!(same_id[0].source, "cli-discovered");

    // Different catalog ids with the same runtime model stay distinct
    // (required when ANTHROPIC_DEFAULT_* map every tier to one model).
    let shared_runtime = dedupe_models_preserve_order(vec![
        ModelInfo::new("claude-opus-5", "kimi-k3")
            .with_runtime_model("kimi-k3")
            .with_source("settings-mapped"),
        ModelInfo::new("claude-sonnet-5", "kimi-k3")
            .with_runtime_model("kimi-k3")
            .with_source("settings-mapped"),
    ]);
    assert_eq!(shared_runtime.len(), 2);
}

#[test]
fn claude_provider_catalog_precedes_and_appends_public_models() {
    let env = std::collections::BTreeMap::from([(
        "ANTHROPIC_MODEL".to_string(),
        "claude-opus-5".to_string(),
    )]);
    let models = finalize_provider_scoped_catalog(
        EngineType::Claude,
        claude_provider_models_from_env("provider-a", &env),
    );

    // Provider catalog carries the full tier list, all scoped to the profile.
    // With only ANTHROPIC_MODEL set, every family falls back to that main slot.
    assert!(
        models
            .iter()
            .filter(|model| model.provider_profile_id.as_deref() == Some("provider-a"))
            .count()
            >= 4
    );
    assert_eq!(models[0].provider_profile_id.as_deref(), Some("provider-a"));
    assert!(models.iter().any(|model| model.id == "claude-opus-5"));
    assert!(models.iter().any(|model| model.id == "claude-sonnet-5"));
    assert!(models
        .iter()
        .filter(|model| model.provider_profile_id.as_deref() == Some("provider-a"))
        .all(|model| model.model == "claude-opus-5"));
}

#[test]
fn codex_provider_catalog_skips_public_fallback_merge() {
    let provider_models = codex_provider_models_from_config(
        "provider-a",
        "model = \"gpt-5.3-codex\"\nmodel_provider = \"proxy-a\"\n",
        vec![crate::types::CodexCustomModel {
            id: "provider-only".to_string(),
            label: "Provider Only".to_string(),
            description: None,
        }],
    )
    .expect("parse provider catalog");
    let models = finalize_provider_scoped_catalog(EngineType::Codex, provider_models);

    assert_eq!(
        models
            .iter()
            .filter(|model| model.model == "gpt-5.3-codex")
            .count(),
        1
    );
    assert!(models.iter().any(|model| {
        model.model == "provider-only"
            && model.provider_profile_id.as_deref() == Some("provider-a")
    }));
    // Codex managed scope 不得出现幽灵官方 fallback 条目
    assert!(models
        .iter()
        .all(|model| model.source != "fallback" && model.provider_profile_id.is_some()));
}

#[test]
fn kimi_provider_catalog_precedes_duplicate_public_model() {
    let provider = crate::types::KimiProviderConfig {
        id: "provider-a".to_string(),
        name: "Provider A".to_string(),
        remark: None,
        website_url: None,
        created_at: None,
        sort_order: None,
        is_active: false,
        is_local_provider: None,
        base_url: "https://example.test".to_string(),
        api_key: "secret".to_string(),
        model: "kimi-for-coding".to_string(),
        provider_type: Some("openai".to_string()),
        max_context_size: None,
        display_name: Some("Provider Kimi".to_string()),
    };
    let models = finalize_provider_scoped_catalog(
        EngineType::Kimi,
        kimi_provider_models_from_config("provider-a", provider),
    );

    assert_eq!(
        models
            .iter()
            .filter(|model| model.model == "kimi-for-coding")
            .count(),
        1
    );
    assert_eq!(models[0].name, "Provider Kimi");
    assert_eq!(models[0].provider_profile_id.as_deref(), Some("provider-a"));
}

#[test]
fn grok_config_models_use_alias_as_runtime_model() {
    let home = std::env::temp_dir().join(format!("ccgui-grok-alias-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&home).expect("create temp grok home");
    std::fs::write(
        home.join("config.toml"),
        "[models]\ndefault = \"grok\"\n\n[model.grok]\nmodel = \"grok-4.5\"\nname = \"Grok 4.5\"\nbase_url = \"https://relay.example.test/v1\"\napi_key = \"sk-test\"\n",
    )
    .expect("write config.toml");

    let models = read_grok_models_from_config(Some(home.as_path()))
        .expect("parse config")
        .expect("models present");

    assert_eq!(models.len(), 1);
    // `-m` must receive the section alias so the CLI resolves the custom
    // base_url/api_key; the inner `model` field would select the built-in.
    assert_eq!(models[0].id, "grok");
    assert_eq!(models[0].model, "grok");
    assert_eq!(models[0].name, "Grok 4.5");
    assert!(models[0].default);

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn grok_provider_models_use_materialized_alias() {
    let provider = crate::types::GrokProviderConfig {
        id: "provider-a".to_string(),
        name: "Provider A".to_string(),
        remark: None,
        website_url: None,
        created_at: None,
        sort_order: None,
        is_active: false,
        is_local_provider: None,
        base_url: "https://example.test".to_string(),
        api_key: "secret".to_string(),
        model: "grok-4.5".to_string(),
        provider_type: None,
        api_backend: Some("responses".to_string()),
        max_context_size: None,
        display_name: Some("Provider Grok".to_string()),
    };
    let models = grok_provider_models_from_config("provider-a", provider);

    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "ccgui/grok-4.5");
    assert_eq!(models[0].model, "ccgui/grok-4.5");
    assert_eq!(models[0].name, "Provider Grok");
    assert!(models[0].default);
}

#[test]
fn generated_fallback_round_trips_provider_protocol_and_provenance() {
    let codex = get_codex_models();
    let gemini = get_gemini_models();
    let grok = get_builtin_grok_models();
    let kimi = get_builtin_kimi_models();
    assert!(!codex.is_empty());
    assert!(!gemini.is_empty());
    assert!(!grok.is_empty());
    assert!(!kimi.is_empty());
    assert!(codex.iter().all(|model| {
        model.provider.as_deref() == Some("openai")
            && model.protocol.as_deref() == Some("openai-responses")
            && model.provenance.as_deref() == Some("generated:model-catalog")
    }));
    assert!(grok.iter().all(|model| {
        model.provider.as_deref() == Some("grok")
            && model.protocol.as_deref() == Some("grok")
            && model.provenance.as_deref() == Some("generated:model-catalog")
    }));
    assert!(kimi.iter().all(|model| {
        model.provider.as_deref() == Some("kimi")
            && model.protocol.as_deref() == Some("kimi")
            && model.provenance.as_deref() == Some("generated:model-catalog")
    }));
    assert!(gemini.iter().all(|model| {
        model.provider.as_deref() == Some("google")
            && model.protocol.as_deref() == Some("google-gemini")
            && model.provenance.as_deref() == Some("generated:model-catalog")
    }));
    let serialized = serde_json::to_value(&codex[0]).expect("serialize model");
    assert_eq!(serialized["provider"], "openai");
    assert_eq!(serialized["protocol"], "openai-responses");
    assert_eq!(serialized["lastVerifiedAt"], "2026-07-27");
    assert_eq!(serialized["lifecycle"], "fallback");
}

#[test]
fn home_dir_detection() {
    // These should not panic
    let _ = get_claude_home_dir();
    let _ = get_codex_home_dir();
    let _ = get_gemini_home_dir();
    let _ = get_opencode_home_dir();
    let _ = get_kimi_home_dir();
    let _ = get_grok_home_dir();
}

#[tokio::test]
async fn resolve_engine_type_supports_opencode() {
    let resolved = resolve_engine_type(
        Some("opencode"),
        Some("claude"),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    )
    .await;
    assert_eq!(resolved, EngineType::OpenCode);
}

#[tokio::test]
async fn resolve_engine_type_normalizes_retired_workspace_gemini_to_allowed_default() {
    let resolved = resolve_engine_type(
        Some("gemini"),
        Some("claude"),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    )
    .await;
    assert_eq!(resolved, EngineType::Claude);
}

#[cfg(unix)]
#[tokio::test]
async fn preferred_engine_detection_never_spawns_or_selects_disabled_gemini() {
    let marker_path = std::env::temp_dir().join(format!(
        "ccgui-gemini-preferred-probe-marker-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let script_path = write_unix_test_cli(&format!(
        "#!/bin/sh\nprintf spawned > '{}'\necho '1.2.3'\n",
        marker_path.display()
    ));

    let resolved = detect_preferred_engine(
        None,
        None,
        Some(script_path.to_string_lossy().as_ref()),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .await;

    assert_ne!(resolved, EngineType::Gemini);
    assert!(
        !marker_path.exists(),
        "preferred detection must skip Gemini"
    );
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&marker_path);
    let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
}

#[cfg(unix)]
#[tokio::test]
async fn add_workspace_resolver_normalizes_legacy_gemini_default_without_spawn() {
    let marker_path = std::env::temp_dir().join(format!(
        "ccgui-gemini-workspace-resolver-marker-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let script_path = write_unix_test_cli(&format!(
        "#!/bin/sh\nprintf spawned > '{}'\necho '1.2.3'\n",
        marker_path.display()
    ));

    let resolved = resolve_engine_type(
        None,
        Some("gemini"),
        None,
        None,
        Some(script_path.to_string_lossy().as_ref()),
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    )
    .await;

    assert_ne!(resolved, EngineType::Gemini);
    assert!(
        !marker_path.exists(),
        "add-workspace resolution must skip Gemini"
    );
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&marker_path);
    let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
}

#[tokio::test]
async fn resolve_engine_type_supports_kimi() {
    let resolved = resolve_engine_type(
        Some("kimi"),
        Some("claude"),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    )
    .await;
    assert_eq!(resolved, EngineType::Kimi);
}

#[tokio::test]
async fn resolve_engine_type_supports_grok() {
    let resolved = resolve_engine_type(
        Some("grok"),
        Some("claude"),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    )
    .await;
    assert_eq!(resolved, EngineType::Grok);
}

#[test]
fn opencode_models_have_defaults() {
    let output = r#"
openai/gpt-5.3-codex
openai/gpt-5.4
opencode/gpt-5-nano
"#;
    let models = parse_opencode_models_output(output);
    assert!(!models.is_empty());
    assert!(models.iter().any(|m| m.default));
    assert!(models.iter().any(|m| m.id == "openai/gpt-5.3-codex"));
    assert!(models.iter().any(|m| m.id == "openai/gpt-5.4"));
}

#[test]
fn opencode_model_name_formatting() {
    let name = format_opencode_model_name("openai", "gpt-5.3-codex");
    assert_eq!(name, "OpenAI/Gpt-5.3-Codex");
}

#[test]
fn parse_opencode_models_output_handles_ansi_and_extra_columns() {
    let output = "\u{1b}[32mopenai/gpt-5.3-codex\u{1b}[0m  default\nminimax-cn-coding-plan/MiniMax-M2.5 available\n";
    let models = parse_opencode_models_output(output);
    assert_eq!(models.len(), 2);
    assert!(models.iter().any(|m| m.id == "openai/gpt-5.3-codex"));
    assert!(models
        .iter()
        .any(|m| m.id == "minimax-cn-coding-plan/MiniMax-M2.5"));
}

#[test]
fn opencode_validation_prefers_runtime_snapshot_over_generated_fallback() {
    let runtime_models =
        parse_opencode_models_output("minimax-cn-coding-plan/MiniMax-M2.5 available\n");
    let selected = resolve_opencode_validation_catalog(
        Some(runtime_models),
        public_models_for_engine(EngineType::OpenCode),
    );

    assert!(selected
        .iter()
        .any(|model| model.id == "minimax-cn-coding-plan/MiniMax-M2.5"));
}

#[test]
fn parse_gemini_model_from_config_json_extracts_trimmed_model() {
    let config = json!({
        "gemini": {
            "env": {
                "GEMINI_MODEL": "  [L]gemini-3-pro-preview  "
            }
        }
    });
    let model = parse_gemini_model_from_config_json(&config);
    assert_eq!(model.as_deref(), Some("[L]gemini-3-pro-preview"));
}

#[cfg(unix)]
fn write_unix_test_cli(script_body: &str) -> PathBuf {
    write_unix_test_cli_named(script_body, "codex-status-cli")
}

#[cfg(unix)]
fn write_unix_test_cli_named(script_body: &str, file_name: &str) -> PathBuf {
    let unique = format!(
        "ccgui-engine-status-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let dir = std::env::temp_dir().join(unique);
    fs::create_dir_all(&dir).expect("create temp cli dir");
    let script_path = dir.join(file_name);
    fs::write(&script_path, script_body).expect("write temp cli script");
    let mut permissions = fs::metadata(&script_path)
        .expect("stat temp cli script")
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&script_path, permissions).expect("chmod temp cli script");
    script_path
}

#[cfg(unix)]
fn unique_test_marker(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "ccgui-detect-marker-{tag}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ))
}

/// refactor-engine-detection-pipeline B1.2：detect_all_engines（启动检测路径）
/// MUST NOT 运行 `opencode models` 目录探测——模型目录只允许走
/// `get_engine_models` 按需路径。
#[cfg(unix)]
#[tokio::test]
async fn detect_all_engines_skips_opencode_model_listing() {
    let marker = unique_test_marker("opencode-models");
    let script_path = write_unix_test_cli_named(
        &format!(
            "#!/bin/sh\ncase \"$1\" in\n  models) printf x >> '{}'\n  ;;\nesac\necho '1.2.3'\n",
            marker.display()
        ),
        "opencode",
    );
    let opencode_bin = script_path.to_string_lossy().to_string();

    let statuses = detect_all_engines(
        None,
        None,
        None,
        Some(&opencode_bin),
        None,
        None,
        None,
        None,
        None,
        &crate::engine::dsh::supervisor::DshRuntimeSettings::default(),
        false,
    )
    .await;

    let opencode = statuses
        .iter()
        .find(|status| status.engine_type == EngineType::OpenCode)
        .expect("opencode status present");
    assert!(
        !marker.exists(),
        "detect_all_engines must not spawn `opencode models` probe"
    );
    assert!(
        opencode.models.is_empty(),
        "lightweight detection must not carry selectable snapshot models"
    );
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&marker);
    let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
}

/// refactor-engine-detection-pipeline B1.2：detect_all_engines MUST NOT 运行
/// PI 的 RPC / `--list-models` models 探测链。
#[cfg(unix)]
#[tokio::test]
async fn detect_all_engines_skips_pi_model_probe_chain() {
    let marker = unique_test_marker("pi-models");
    let script_path = write_unix_test_cli_named(
        &format!(
            "#!/bin/sh\ncase \"$*\" in\n  *list-models*|*rpc*) printf x >> '{}'\n  ;;\nesac\necho '1.2.3'\n",
            marker.display()
        ),
        "pi",
    );
    let pi_bin = script_path.to_string_lossy().to_string();

    let statuses = detect_all_engines(
        None,
        None,
        None,
        None,
        None,
        None,
        Some(&pi_bin),
        None,
        None,
        &crate::engine::dsh::supervisor::DshRuntimeSettings::default(),
        false,
    )
    .await;

    let pi = statuses
        .iter()
        .find(|status| status.engine_type == EngineType::Pi)
        .expect("pi status present");
    assert!(
        !marker.exists(),
        "detect_all_engines must not spawn the pi models probe chain"
    );
    assert!(
        pi.models.iter().all(|model| model.source == "fallback"),
        "lightweight detection carries a fallback snapshot only"
    );
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&marker);
    let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
}

/// refactor-engine-detection-pipeline B1.1：detect_all_engines MUST NOT 运行
/// Qoder 的 `--acp` ACP 握手 / `session/new` models 探测。
#[cfg(unix)]
#[tokio::test]
async fn detect_all_engines_skips_qoder_acp_model_probe() {
    let marker = unique_test_marker("qoder-acp");
    let script_path = write_unix_test_cli_named(
        &format!(
            "#!/bin/sh\ncase \"$1\" in\n  --acp) printf x >> '{}'\n  ;;\n  status) printf '{{\"authenticated\": true}}'\n  ;;\nesac\necho '1.2.3'\n",
            marker.display()
        ),
        "qodercli",
    );
    let qoder_bin = script_path.to_string_lossy().to_string();

    let statuses = detect_all_engines(
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(&qoder_bin),
        &crate::engine::dsh::supervisor::DshRuntimeSettings::default(),
        false,
    )
    .await;

    let qoder = statuses
        .iter()
        .find(|status| status.engine_type == EngineType::Qoder)
        .expect("qoder status present");
    assert!(
        qoder.installed,
        "fake qodercli reports a version, detection must treat it as installed"
    );
    assert!(
        !marker.exists(),
        "detect_all_engines must not run the qoder ACP model probe"
    );
    assert!(
        qoder.models.is_empty(),
        "qoder is ACP runtime-only: fallback snapshot stays empty"
    );
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&marker);
    let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
}

/// refactor-engine-detection-pipeline B1.3（启用范围铁律）：黑名单引擎
/// MUST 0 spawn 且不出现在结果中，其余引擎照常。
#[cfg(unix)]
#[tokio::test]
async fn detect_all_engines_scoped_skips_disabled_engines_without_spawning() {
    let marker = unique_test_marker("kimi-disabled");
    let script_path = write_unix_test_cli_named(
        &format!(
            "#!/bin/sh\nprintf x >> '{}'\necho '1.2.3'\n",
            marker.display()
        ),
        "kimi",
    );
    let kimi_bin = script_path.to_string_lossy().to_string();

    let statuses = detect_all_engines_scoped(
        None,
        None,
        None,
        None,
        Some(&kimi_bin),
        None,
        None,
        None,
        None,
        &crate::engine::dsh::supervisor::DshRuntimeSettings::default(),
        false,
        &[EngineType::Kimi],
        0,
        None,
    )
    .await;

    assert!(
        statuses
            .iter()
            .all(|status| status.engine_type != EngineType::Kimi),
        "disabled engine must not appear in detection results"
    );
    assert!(
        !marker.exists(),
        "disabled engine must not be probed at all"
    );
    assert!(
        statuses
            .iter()
            .any(|status| status.engine_type == EngineType::Grok),
        "other engines keep being detected"
    );
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&marker);
    let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
}

/// refactor-engine-detection-pipeline B1.4（隔离铁律）：单引擎探测 panic
/// MUST 只落该引擎 error，其他引擎结果不受影响。
#[tokio::test]
async fn engine_detection_isolation_contains_panicking_probe() {
    let healthy = run_engine_detection_isolated(
        EngineType::Kimi,
        || async {
            let mut status = disabled_engine_status(EngineType::Kimi);
            status.installed = true;
            status.version = Some("1.0.0".to_string());
            status
        },
        0,
        None,
    );
    let panicking = run_engine_detection_isolated(
        EngineType::Grok,
        || async {
            panic!("probe exploded");
            #[allow(unreachable_code)]
            disabled_engine_status(EngineType::Grok)
        },
        0,
        None,
    );
    let (healthy, panicking) = tokio::join!(healthy, panicking);

    assert!(
        healthy.installed,
        "healthy engine detection must be unaffected by the panicking probe"
    );
    assert!(!panicking.installed);
    assert!(
        panicking
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("engine detection task failed"),
        "panic must be contained as a per-engine error, got {:?}",
        panicking.error
    );
}

/// refactor-engine-detection-pipeline B6：Qoder 检测 phase 1 MUST NOT
/// spawn 登录探测命令（`qodercli status`）——spawn 型探测延后到 phase 2。
#[cfg(unix)]
#[tokio::test]
async fn detect_all_engines_qoder_phase1_never_spawns_login_probe() {
    let marker = unique_test_marker("qoder-login-phase1");
    let script_path = write_unix_test_cli_named(
        &format!(
            "#!/bin/sh\ncase \"$*\" in\n  *status*) printf x >> '{}'\n  ;;\nesac\necho '1.2.3'\n",
            marker.display()
        ),
        "qodercli",
    );
    let qoder_bin = script_path.to_string_lossy().to_string();

    let statuses = detect_all_engines_scoped(
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(&qoder_bin),
        &crate::engine::dsh::supervisor::DshRuntimeSettings::default(),
        false,
        &[],
        0,
        None,
    )
    .await;

    let qoder = statuses
        .iter()
        .find(|status| status.engine_type == EngineType::Qoder)
        .expect("qoder status present");
    assert!(qoder.installed, "fake qodercli reports a version");
    assert!(
        !marker.exists(),
        "phase 1 detection must not spawn `qodercli status` login probe"
    );
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&marker);
    let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
}

/// P0 回归锁定：轻量分支 MUST NOT 回填静态快照——EngineStatus.models 是
/// 乐观选中/新会话默认解析的消费源，静态条目（auto，default=true）曾把
/// 错误模型绑进 PI 会话（多引擎切换后必现模型错乱 + 发送失败）。目录
/// 只允许 get_engine_models 真实探测权威填充。
#[cfg(unix)]
#[tokio::test]
async fn detect_pi_light_must_not_carry_snapshot_models() {
    let marker = unique_test_marker("pi-light-backfill");
    let script_path = write_unix_test_cli_named(
        &format!(
            "#!/bin/sh\nprintf x >> '{}'\necho '1.2.3'\n",
            marker.display()
        ),
        "pi",
    );
    let pi_bin = script_path.to_string_lossy().to_string();

    let status = detect_pi_status_with_options(Some(&pi_bin), false).await;

    assert!(status.installed);
    assert!(
        status.models.is_empty() && status.default_model.is_none(),
        "light detection must not carry selectable snapshot models (poisons optimistic selection)"
    );
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&marker);
    let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
}

/// refactor-engine-detection-pipeline B4：逐引擎事件——每引擎探测完成
/// 恰好 emit 一次（runId 单调由 manager 计数保证，这里断言 sink 收集）。
#[cfg(unix)]
#[tokio::test]
async fn detect_all_engines_emits_per_engine_status_events() {
    use std::sync::Mutex as StdMutex;

    let marker = unique_test_marker("kimi-emit");
    let script_path = write_unix_test_cli_named(
        &format!(
            "#!/bin/sh\nprintf x >> '{}'\necho '1.2.3'\n",
            marker.display()
        ),
        "kimi",
    );
    let kimi_bin = script_path.to_string_lossy().to_string();

    let events: Arc<StdMutex<Vec<(u64, EngineType)>>> = Arc::new(StdMutex::new(Vec::new()));
    let sink_events = Arc::clone(&events);
    let on_status: EngineStatusEventSink = Arc::new(move |run_id, status| {
        sink_events
            .lock()
            .expect("events lock")
            .push((run_id, status.engine_type));
    });

    // 仅保留 kimi 启用：事件数 = 实际探测的引擎数（禁用引擎不探测不 emit）。
    let statuses = detect_all_engines_scoped(
        None,
        None,
        None,
        None,
        Some(&kimi_bin),
        None,
        None,
        None,
        None,
        &crate::engine::dsh::supervisor::DshRuntimeSettings::default(),
        false,
        &[
            EngineType::Claude,
            EngineType::Codex,
            EngineType::OpenCode,
            EngineType::Grok,
            EngineType::Pi,
            EngineType::Omp,
            EngineType::Qoder,
            EngineType::Dsh,
        ],
        7,
        Some(on_status),
    )
    .await;

    assert!(
        statuses
            .iter()
            .any(|status| status.engine_type == EngineType::Kimi && status.installed),
        "fake kimi must be detected"
    );
    let events = events.lock().expect("events lock");
    assert_eq!(
        events.len(),
        1,
        "exactly one per-engine event must be emitted"
    );
    assert_eq!(events[0], (7, EngineType::Kimi));
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&marker);
    let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
}

/// refactor-engine-detection-pipeline B2：同一轮 Claude 检测内 `claude --version`
/// MUST 只 spawn 一次（find_claude_code_binary 的候选验证结果 MUST 被复用，
/// 不得在 probe_cli_version 里重复探测）。
#[cfg(unix)]
#[tokio::test]
async fn detect_claude_status_probes_version_once_per_round() {
    let marker = unique_test_marker("claude-version");
    let script_path = write_unix_test_cli_named(
        &format!(
            "#!/bin/sh\nprintf x >> '{}'\necho '1.2.3 (Claude Code)'\n",
            marker.display()
        ),
        "claude",
    );
    let claude_bin = script_path.to_string_lossy().to_string();

    let status = detect_claude_status(Some(&claude_bin)).await;

    assert!(status.installed, "fake claude reports a version");
    let marker_text = fs::read_to_string(&marker).unwrap_or_default();
    assert_eq!(
        marker_text.chars().count(),
        1,
        "claude --version must be probed exactly once per detection round, got {} invocations",
        marker_text.chars().count()
    );
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&marker);
    let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
}

#[cfg(unix)]
#[tokio::test]
async fn disabled_gemini_shared_detection_never_spawns_configured_cli() {
    let marker_path = std::env::temp_dir().join(format!(
        "ccgui-gemini-shared-probe-marker-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let script_path = write_unix_test_cli(&format!(
        "#!/bin/sh\nprintf spawned > '{}'\necho '1.2.3'\n",
        marker_path.display()
    ));

    let status = detect_gemini_status(Some(script_path.to_string_lossy().as_ref())).await;

    assert!(!status.installed);
    assert_eq!(
        status.error.as_deref(),
        Some(crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC)
    );
    assert!(!marker_path.exists(), "shared Gemini probe must not spawn");
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&marker_path);
    let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
}

#[cfg(unix)]
#[tokio::test]
async fn detect_codex_status_does_not_execute_resolved_cli() {
    let marker_path = std::env::temp_dir().join(format!(
        "ccgui-codex-startup-probe-marker-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let script_body = format!(
        "#!/bin/sh\nprintf '%s\\n' \"$1\" >> {}\necho 'codex 0.0.0'\nexit 0\n",
        marker_path.to_string_lossy()
    );
    let script_path = write_unix_test_cli(&script_body);

    let status = detect_codex_status(Some(script_path.to_string_lossy().as_ref())).await;

    assert!(status.installed);
    assert_eq!(status.engine_type, EngineType::Codex);
    assert!(
        !marker_path.exists(),
        "startup Codex status detection must not execute the resolved CLI"
    );

    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&marker_path);
    let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
}

#[cfg(unix)]
#[tokio::test]
async fn detect_codex_status_reports_metadata_for_unprobeable_cli() {
    let script_path = write_unix_test_cli(
        "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo 'broken version' >&2\n  exit 1\nfi\nif [ \"$1\" = \"--help\" ]; then\n  echo 'usage'\n  exit 0\nfi\nexit 1\n",
    );

    let status = detect_codex_status(Some(script_path.to_string_lossy().as_ref())).await;
    assert!(status.installed);
    assert!(status.version.is_none());
    assert_eq!(status.engine_type, EngineType::Codex);
    assert!(status.bin_path.is_some());
    assert!(status.error.is_none());

    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
}

#[cfg(unix)]
#[tokio::test]
async fn detect_opencode_status_falls_back_to_generated_roster_when_models_probe_fails() {
    let unique = format!(
        "ccgui-opencode-light-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let dir = std::env::temp_dir().join(unique);
    fs::create_dir_all(&dir).expect("create temp cli dir");
    let script_path = dir.join("opencode");
    let script_body =
        "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo '1.2.3'\n  exit 0\nfi\nif [ \"$1\" = \"--help\" ]; then\n  echo 'usage'\n  exit 0\nfi\nif [ \"$1\" = \"models\" ]; then\n  echo 'models should not run' >&2\n  exit 7\nfi\nexit 0\n";
    fs::write(&script_path, script_body).expect("write temp cli script");
    let mut permissions = fs::metadata(&script_path)
        .expect("stat temp cli script")
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&script_path, permissions).expect("chmod temp cli script");

    let status = detect_opencode_status(Some(script_path.to_string_lossy().as_ref())).await;
    assert!(status.installed);
    assert!(
        !status.models.is_empty(),
        "failed models probe must fall back to the generated roster"
    );
    assert!(status.error.is_none());

    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(windows)]
#[tokio::test]
async fn detect_opencode_status_rejects_launcher_like_windows_candidate() {
    let unique = format!(
        "ccgui-opencode-launcher-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let root = std::env::temp_dir().join(unique);
    let bin_path = root
        .join("AppData")
        .join("Local")
        .join("Programs")
        .join("OpenCode")
        .join("opencode.exe");
    fs::create_dir_all(bin_path.parent().expect("launcher dir")).expect("create launcher dir");
    fs::write(&bin_path, []).expect("create fake launcher");

    let status = detect_opencode_status(Some(bin_path.to_string_lossy().as_ref())).await;
    assert!(!status.installed);
    assert!(status
        .error
        .as_deref()
        .unwrap_or_default()
        .contains("[OPENCODE_CLI_UNSAFE]"));

    let _ = fs::remove_file(&bin_path);
    let _ = fs::remove_dir_all(&root);
}
