
    use super::{
        AppSettings, BackendMode, EmailSenderProvider, EmailSenderSecurity, GitFileStatus,
        WorkspaceEntry, WorkspaceGroup, WorkspaceKind, WorkspaceSessionAttributionMode,
        WorkspaceSettings,
    };

    #[test]
    fn git_file_status_serializes_optional_rename_source_as_old_path() {
        let renamed = GitFileStatus {
            path: "archive/spec.md".to_string(),
            old_path: Some("changes/spec.md".to_string()),
            status: "R".to_string(),
            additions: 0,
            deletions: 0,
        };
        let renamed_json = serde_json::to_value(renamed).expect("serialize rename status");
        assert_eq!(renamed_json["path"], "archive/spec.md");
        assert_eq!(renamed_json["oldPath"], "changes/spec.md");

        let modified = GitFileStatus {
            path: "src/app.ts".to_string(),
            old_path: None,
            status: "M".to_string(),
            additions: 1,
            deletions: 0,
        };
        let modified_json = serde_json::to_value(modified).expect("serialize modified status");
        assert!(modified_json.get("oldPath").is_none());
    }

    #[test]
    fn workspace_wallpaper_round_trips_fluid_motion() {
        let raw = r#"{
            "workspaceWallpaper": {
                "mode": "fluid",
                "customImagePath": null,
                "fluidPreset": "ash",
                "fluidMotion": "tornado",
                "veilOpacity": 20
            }
        }"#;
        let settings: AppSettings = serde_json::from_str(raw).expect("settings deserialize");
        assert_eq!(settings.workspace_wallpaper.fluid_motion, "tornado");
        assert_eq!(settings.workspace_wallpaper.fluid_preset, "ash");
        assert_eq!(settings.workspace_wallpaper.veil_opacity, 20);

        let echoed = serde_json::to_value(&settings).expect("serialize");
        assert_eq!(echoed["workspaceWallpaper"]["fluidMotion"], "tornado");
        assert_eq!(echoed["workspaceWallpaper"]["fluidPreset"], "ash");

        let legacy = r#"{
            "workspaceWallpaper": {
                "mode": "fluid",
                "fluidPreset": "ash"
            }
        }"#;
        let legacy_settings: AppSettings =
            serde_json::from_str(legacy).expect("legacy deserialize");
        assert_eq!(legacy_settings.workspace_wallpaper.fluid_motion, "drift");
        assert_eq!(legacy_settings.workspace_wallpaper.fluid_preset, "ash");
        assert_eq!(legacy_settings.workspace_wallpaper.veil_opacity, 0);
    }

    #[test]
    fn app_settings_round_trips_last_composer_prefs_by_engine() {
        let raw = r#"{
            "lastComposerPrefsByEngine": {
                "claude": {
                    "modelId": "claude-opus-4-8",
                    "effort": null,
                    "accessMode": "full-access",
                    "collaborationModeId": "code"
                }
            }
        }"#;
        let settings: AppSettings = serde_json::from_str(raw).expect("settings deserialize");
        let prefs = settings
            .last_composer_prefs_by_engine
            .as_ref()
            .expect("prefs preserved");
        assert_eq!(
            prefs["claude"]["accessMode"],
            serde_json::Value::String("full-access".to_string())
        );

        let echoed = serde_json::to_string(&settings).expect("settings serialize");
        let reparsed: AppSettings = serde_json::from_str(&echoed).expect("echo deserialize");
        assert_eq!(
            reparsed.last_composer_prefs_by_engine,
            settings.last_composer_prefs_by_engine
        );
    }

    #[test]
    fn app_settings_round_trips_all_frontend_shortcut_fields() {
        let shortcut_payload = serde_json::json!({
            "openSettingsShortcut": "cmd+alt+,",
            "newWindowShortcut": "cmd+alt+w",
            "openChatShortcut": "cmd+alt+j",
            "cycleOpenSessionPrevShortcut": "cmd+alt+left",
            "cycleOpenSessionNextShortcut": "cmd+alt+right",
            "toggleLeftConversationSidebarShortcut": "cmd+ctrl+[",
            "toggleRightConversationSidebarShortcut": "cmd+ctrl+]",
            "toggleRuntimeConsoleShortcut": "cmd+alt+`",
            "toggleFilesSurfaceShortcut": "cmd+alt+e",
            "saveFileShortcut": "cmd+alt+s",
            "findInFileShortcut": "cmd+alt+f",
            "expandSelectionShortcut": "ctrl+alt+w",
            "toggleGitDiffListViewShortcut": "cmd+alt+v",
            "toggleGitGraphShortcut": "cmd+alt+g",
            "openNotesShortcut": null,
            "openIntentCanvasShortcut": "cmd+alt+i",
            "openRadarShortcut": "cmd+alt+r",
            "openProjectMapShortcut": "cmd+alt+m",
            "openBrowserDockShortcut": "cmd+alt+b",
            "openFileCompareShortcut": "cmd+alt+c",
            "increaseUiScaleShortcut": "cmd+alt+=",
            "decreaseUiScaleShortcut": "cmd+alt+-",
            "resetUiScaleShortcut": "cmd+alt+0"
        });
        let settings: AppSettings =
            serde_json::from_value(shortcut_payload.clone()).expect("settings deserialize");
        let echoed = serde_json::to_value(settings).expect("settings serialize");

        for (key, expected) in shortcut_payload
            .as_object()
            .expect("shortcut payload object")
        {
            assert_eq!(echoed.get(key), Some(expected), "shortcut field {key}");
        }
    }

    #[test]
    fn app_settings_ignores_legacy_open_kanban_shortcut() {
        let settings: AppSettings = serde_json::from_value(serde_json::json!({
            "openKanbanShortcut": "cmd+alt+k",
            "openChatShortcut": "cmd+alt+j",
        }))
        .expect("legacy settings deserialize");
        assert_eq!(settings.open_chat_shortcut.as_deref(), Some("cmd+alt+j"));
        let echoed = serde_json::to_value(settings).expect("settings serialize");
        assert!(echoed.get("openKanbanShortcut").is_none());
    }

    #[test]
    fn app_settings_round_trips_disabled_cli_engines() {
        // 前端 CLI 可见性开关的持久化链路:serde 未知字段默认被丢弃,
        // 此测试锁定 disabledCliEngines 必须完整往返,防止再次静默丢字段。
        let payload = serde_json::json!({
            "disabledCliEngines": ["opencode", "kimi"],
        });
        let settings: AppSettings = serde_json::from_value(payload).expect("settings deserialize");
        assert_eq!(
            settings.disabled_cli_engines,
            vec!["opencode".to_string(), "kimi".to_string()]
        );

        let echoed = serde_json::to_value(settings).expect("settings serialize");
        assert_eq!(
            echoed.get("disabledCliEngines"),
            Some(&serde_json::json!(["opencode", "kimi"]))
        );
    }

    #[test]
    fn app_settings_defaults_from_empty_json() {
        let settings: AppSettings = serde_json::from_str("{}").expect("settings deserialize");
        assert!(settings.codex_bin.is_none());
        assert!(matches!(settings.backend_mode, BackendMode::Local));
        assert_eq!(settings.remote_backend_host, "127.0.0.1:4732");
        assert!(settings.remote_backend_token.is_none());
        assert_eq!(settings.web_service_port, 3080);
        assert!(settings.web_service_token.is_none());
        assert!(settings.custom_skill_directories.is_empty());
        assert!(!settings.system_proxy_enabled);
        assert!(!settings.gemini_enabled);
        assert!(settings.opencode_enabled);
        assert!(settings.disabled_cli_engines.is_empty());
        assert_eq!(
            settings.session_attribution_mode,
            WorkspaceSessionAttributionMode::Related
        );
        assert!(settings.system_proxy_url.is_none());
        assert_eq!(settings.default_access_mode, "full-access");
        assert_eq!(
            settings.composer_model_shortcut.as_deref(),
            Some("cmd+shift+m")
        );
        assert_eq!(
            settings.composer_access_shortcut.as_deref(),
            Some("cmd+shift+a")
        );
        assert_eq!(
            settings.composer_reasoning_shortcut.as_deref(),
            Some("cmd+shift+r")
        );
        assert_eq!(
            settings.composer_collaboration_shortcut.as_deref(),
            Some("shift+tab")
        );
        let expected_interrupt = if cfg!(target_os = "macos") {
            "ctrl+c"
        } else {
            "ctrl+shift+c"
        };
        assert_eq!(
            settings.interrupt_shortcut.as_deref(),
            Some(expected_interrupt)
        );
        assert_eq!(
            settings.archive_thread_shortcut.as_deref(),
            Some("cmd+ctrl+a")
        );
        assert_eq!(
            settings.close_current_session_shortcut.as_deref(),
            Some("cmd+w")
        );
        assert_eq!(settings.expand_selection_shortcut.as_deref(), Some("cmd+w"));
        assert_eq!(
            settings.toggle_debug_panel_shortcut.as_deref(),
            Some("cmd+shift+d")
        );
        assert_eq!(
            settings.toggle_terminal_shortcut.as_deref(),
            Some("cmd+shift+t")
        );
        assert_eq!(
            settings.toggle_global_search_shortcut.as_deref(),
            Some("cmd+o")
        );
        assert_eq!(
            settings.cycle_agent_next_shortcut.as_deref(),
            Some("cmd+ctrl+down")
        );
        assert_eq!(
            settings.cycle_agent_prev_shortcut.as_deref(),
            Some("cmd+ctrl+up")
        );
        assert_eq!(
            settings.cycle_workspace_next_shortcut.as_deref(),
            Some("cmd+shift+down")
        );
        assert_eq!(
            settings.cycle_workspace_prev_shortcut.as_deref(),
            Some("cmd+shift+up")
        );
        assert!(settings.last_composer_model_id.is_none());
        assert!(settings.last_composer_reasoning_effort.is_none());
        assert!((settings.ui_scale - 1.0).abs() < f64::EPSILON);
        assert_eq!(settings.theme, "system");
        assert_eq!(settings.light_theme_preset_id, "vscode-light-modern");
        assert_eq!(settings.dark_theme_preset_id, "vscode-dark-modern");
        assert_eq!(settings.custom_theme_preset_id, "vscode-dark-modern");
        assert!(settings.user_msg_color.is_empty());
        assert!(!settings.usage_show_remaining);
        assert!(settings.show_message_anchors);
        assert!(!settings.show_sidebar_provider_labels);
        assert_eq!(settings.default_visible_thread_root_count, 5);
        assert!(!settings.performance_compatibility_mode_enabled);
        assert_eq!(settings.canvas_width_mode, "narrow");
        assert_eq!(settings.layout_mode, "default");
        assert!(settings.ui_font_family.starts_with("Monaco"));
        assert!(settings.code_font_family.starts_with("Monaco"));
        assert_eq!(settings.code_font_size, 11);
        assert!(settings.notification_sounds_enabled);
        assert_eq!(settings.notification_sound_id, "default");
        assert!(settings.notification_sound_custom_path.is_empty());
        assert!(settings.system_notification_enabled);
        assert!(!settings.email_sender.enabled);
        assert_eq!(settings.email_sender.provider, EmailSenderProvider::Custom);
        assert!(settings.email_sender.sender_email.is_empty());
        assert!(settings.email_sender.sender_name.is_empty());
        assert!(settings.email_sender.smtp_host.is_empty());
        assert_eq!(settings.email_sender.smtp_port, 465);
        assert_eq!(settings.email_sender.security, EmailSenderSecurity::SslTls);
        assert!(settings.email_sender.username.is_empty());
        assert!(settings.email_sender.recipient_email.is_empty());
        assert!(settings.preload_git_diffs);
        assert!(settings.detached_external_change_awareness_enabled);
        assert!(settings.detached_external_change_watcher_enabled);
        assert!(!settings.experimental_steer_enabled);
        assert!(settings.codex_mode_enforcement_enabled);
        assert!(!settings.chat_canvas_use_normalized_realtime);
        assert!(!settings.chat_canvas_use_unified_history_loader);
        assert!(!settings.chat_canvas_use_presentation_profile);
        assert_eq!(settings.composer_editor_preset, "default");
        assert_eq!(settings.composer_send_shortcut, "enter");
        assert!(!settings.composer_fence_expand_on_space);
        assert!(!settings.composer_fence_expand_on_enter);
        assert!(!settings.composer_fence_language_tags);
        assert!(!settings.composer_fence_wrap_selection);
        assert!(!settings.composer_fence_auto_wrap_paste_multiline);
        assert!(!settings.composer_fence_auto_wrap_paste_code_like);
        assert!(!settings.composer_list_continuation);
        assert!(!settings.composer_code_block_copy_use_modifier);
        assert!(settings.workspace_groups.is_empty());
        assert_eq!(settings.selected_open_app_id, "vscode");
        assert_eq!(settings.open_app_targets.len(), 6);
        assert_eq!(settings.open_app_targets[0].id, "vscode");
        assert!(settings.codex_auto_compaction_enabled);
    }

    #[test]
    fn workspace_group_defaults_from_minimal_json() {
        let group: WorkspaceGroup =
            serde_json::from_str(r#"{"id":"g1","name":"Group"}"#).expect("group deserialize");
        assert!(group.sort_order.is_none());
        assert!(group.copies_folder.is_none());
    }

    #[test]
    fn app_settings_round_trip_preserves_workspace_group_copies_folder() {
        let mut settings = AppSettings::default();
        settings.workspace_groups = vec![WorkspaceGroup {
            id: "g1".to_string(),
            name: "Group".to_string(),
            sort_order: Some(2),
            copies_folder: Some("/tmp/group-copies".to_string()),
        }];

        let json = serde_json::to_string(&settings).expect("serialize settings");
        let decoded: AppSettings = serde_json::from_str(&json).expect("deserialize settings");
        assert_eq!(decoded.workspace_groups.len(), 1);
        assert_eq!(
            decoded.workspace_groups[0].copies_folder.as_deref(),
            Some("/tmp/group-copies")
        );
    }

    #[test]
    fn app_settings_round_trip_preserves_session_attribution_mode() {
        let mut settings = AppSettings::default();
        settings.session_attribution_mode = WorkspaceSessionAttributionMode::WorkspaceOnly;

        let json = serde_json::to_string(&settings).expect("serialize settings");
        assert!(json.contains(r#""sessionAttributionMode":"workspace-only""#));
        let decoded: AppSettings = serde_json::from_str(&json).expect("deserialize settings");

        assert_eq!(
            decoded.session_attribution_mode,
            WorkspaceSessionAttributionMode::WorkspaceOnly
        );
    }

    #[test]
    fn app_settings_defaults_invalid_session_attribution_mode_to_related() {
        let decoded: AppSettings = serde_json::from_str(r#"{"sessionAttributionMode":"invalid"}"#)
            .expect("deserialize settings");

        assert_eq!(
            decoded.session_attribution_mode,
            WorkspaceSessionAttributionMode::Related
        );

        let decoded: AppSettings = serde_json::from_str(r#"{"sessionAttributionMode":123}"#)
            .expect("deserialize settings");

        assert_eq!(
            decoded.session_attribution_mode,
            WorkspaceSessionAttributionMode::Related
        );
    }

    #[test]
    fn app_settings_sanitize_runtime_pool_settings_clamps_budget_fields() {
        let mut settings = AppSettings::default();
        settings.codex_max_hot_runtimes = 200;
        settings.codex_max_warm_runtimes = 99;
        settings.codex_warm_ttl_seconds = 20_000;
        settings.codex_auto_compaction_threshold_percent = 93;
        settings.default_visible_thread_root_count = 99;

        settings.sanitize_runtime_pool_settings();

        assert_eq!(settings.codex_max_hot_runtimes, 8);
        assert_eq!(settings.codex_max_warm_runtimes, 16);
        assert_eq!(settings.codex_warm_ttl_seconds, 14_400);
        assert_eq!(settings.codex_auto_compaction_threshold_percent, 92);
        assert_eq!(settings.default_visible_thread_root_count, 20);
    }

    #[test]
    fn app_settings_sanitize_runtime_pool_settings_keeps_allowed_compaction_thresholds() {
        for threshold in [92, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200] {
            let mut settings = AppSettings::default();
            settings.codex_auto_compaction_threshold_percent = threshold;

            settings.sanitize_runtime_pool_settings();

            assert_eq!(settings.codex_auto_compaction_threshold_percent, threshold);
        }
    }

    #[test]
    fn app_settings_defaults_disable_retired_optional_engines() {
        let settings = AppSettings::default();
        assert!(!settings.gemini_enabled);
        // OpenCode is an always-enabled engine again; the legacy flag defaults to true
        // and no longer gates runtime policy.
        assert!(settings.opencode_enabled);
    }

    #[test]
    fn app_settings_sanitizer_forces_legacy_gemini_true_to_false() {
        let mut settings: AppSettings =
            serde_json::from_str(r#"{"geminiEnabled":true,"defaultEngine":"gemini"}"#)
                .expect("deserialize legacy settings");
        assert!(settings.gemini_enabled);
        assert_eq!(settings.default_engine.as_deref(), Some("gemini"));

        settings.sanitize_engine_gates();

        assert!(!settings.gemini_enabled);
        assert!(settings.default_engine.is_none());
    }

    #[test]
    fn app_settings_sanitizer_preserves_legacy_opencode_values() {
        let mut settings: AppSettings =
            serde_json::from_str(r#"{"opencodeEnabled":true,"defaultEngine":"opencode"}"#)
                .expect("deserialize legacy settings");
        assert!(settings.opencode_enabled);
        assert_eq!(settings.default_engine.as_deref(), Some("opencode"));

        settings.sanitize_engine_gates();

        // OpenCode is always enabled at runtime; the sanitizer must not clear
        // the legacy flag or a persisted opencode default engine.
        assert!(settings.opencode_enabled);
        assert_eq!(settings.default_engine.as_deref(), Some("opencode"));
    }

    #[test]
    fn app_settings_defaults_enable_core_curated_skills() {
        let settings = AppSettings::default();
        assert_eq!(
            settings.enabled_curated_skill_ids,
            vec!["lazy-senior-dev".to_string(), "caveman".to_string()]
        );

        let decoded: AppSettings = serde_json::from_str("{}").expect("deserialize settings");
        assert_eq!(
            decoded.enabled_curated_skill_ids,
            vec!["lazy-senior-dev".to_string(), "caveman".to_string()]
        );
    }

    #[test]
    fn app_settings_preserves_explicitly_empty_curated_skill_ids() {
        let decoded: AppSettings =
            serde_json::from_str(r#"{"enabledCuratedSkillIds":[]}"#).expect("deserialize settings");

        assert!(decoded.enabled_curated_skill_ids.is_empty());
    }

    #[test]
    fn app_settings_upgrade_runtime_pool_settings_for_startup_raises_legacy_warm_ttl() {
        let mut settings = AppSettings::default();
        settings.codex_warm_ttl_seconds = 300;

        settings.upgrade_runtime_pool_settings_for_startup();

        assert_eq!(settings.codex_warm_ttl_seconds, 7200);
    }

    #[test]
    fn workspace_entry_defaults_from_minimal_json() {
        let entry: WorkspaceEntry =
            serde_json::from_str(r#"{"id":"1","name":"Test","path":"/tmp","codexBin":null}"#)
                .expect("workspace deserialize");
        assert!(matches!(entry.kind, WorkspaceKind::Main));
        assert!(entry.parent_id.is_none());
        assert!(entry.worktree.is_none());
        assert!(entry.settings.sort_order.is_none());
        assert!(entry.settings.group_id.is_none());
    }

    #[test]
    fn workspace_settings_defaults() {
        let settings = WorkspaceSettings::default();
        assert!(!settings.sidebar_collapsed);
        assert!(settings.sort_order.is_none());
        assert!(settings.group_id.is_none());
        assert!(settings.git_root.is_none());
    }

