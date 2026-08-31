    use super::*;

    #[test]
    fn disabled_settings_do_not_select_builtin_provider() {
        let settings = BrowserAgentSettings {
            enabled: false,
            ..BrowserAgentSettings::default()
        };
        let decision = default_route_decision(
            "read_snapshot",
            &settings,
            false,
            &platform::current_platform_capability(),
        );
        assert_eq!(decision.selected_provider, "browser_skill");
        assert!(decision.fallback_used);
        assert_eq!(
            decision.fallback_reason.as_deref(),
            Some("browser_agent_disabled")
        );
    }

    #[test]
    fn enabled_settings_select_builtin_provider() {
        let settings = BrowserAgentSettings {
            enabled: true,
            ..BrowserAgentSettings::default()
        };
        let decision = default_route_decision(
            "read_snapshot",
            &settings,
            false,
            &platform::current_platform_capability(),
        );
        assert_eq!(decision.selected_provider, "built_in_browser_agent");
        assert!(!decision.fallback_used);
    }

    #[test]
    fn embedded_renderer_uses_a_stable_singleton_label() {
        assert_eq!(BROWSER_RENDERER_WEBVIEW_LABEL, "browser-agent-webview-main",);
    }

    #[test]
    fn embedded_renderer_binding_does_not_replace_floating_renderer_binding() {
        const FLOATING_SESSION_ID: &str = "test-floating-session";
        const EMBEDDED_SESSION_ID: &str = "test-embedded-session";

        clear_browser_renderer_session(FLOATING_SESSION_ID);
        clear_browser_embedded_webview_session(EMBEDDED_SESSION_ID);
        bind_browser_renderer_session(FLOATING_SESSION_ID);
        begin_browser_embedded_webview_navigation(EMBEDDED_SESSION_ID, "https://embedded.example/");

        assert_eq!(
            current_browser_renderer_session_id().as_deref(),
            Some(FLOATING_SESSION_ID),
        );
        assert_eq!(
            current_browser_embedded_webview_session_id().as_deref(),
            Some(EMBEDDED_SESSION_ID),
        );

        clear_browser_embedded_webview_session(EMBEDDED_SESSION_ID);
        assert_eq!(
            current_browser_renderer_session_id().as_deref(),
            Some(FLOATING_SESSION_ID),
        );
        clear_browser_renderer_session(FLOATING_SESSION_ID);
    }

    #[test]
    fn embedded_renderer_binding_rejects_late_page_and_title_callbacks() {
        let mut binding =
            EmbeddedBrowserWebviewBinding::navigating_to("session-b", "https://b.example/page");

        assert_eq!(
            binding.accepts_page_load(
                "https://a.example/page",
                tauri::webview::PageLoadEvent::Started,
            ),
            None,
        );
        assert_eq!(binding.accepts_title("https://a.example/page"), None);
        assert_eq!(
            binding.accepts_page_load(
                "https://b.example/page",
                tauri::webview::PageLoadEvent::Finished,
            ),
            None,
        );

        assert_eq!(
            binding.accepts_page_load(
                "https://b.example/page#section",
                tauri::webview::PageLoadEvent::Started,
            ),
            Some("session-b".to_string()),
        );
        assert_eq!(binding.accepts_title("https://a.example/page"), None);
        assert_eq!(
            binding.accepts_title("https://b.example/page"),
            Some("session-b".to_string()),
        );
        assert_eq!(
            binding.accepts_page_load(
                "https://b.example/page",
                tauri::webview::PageLoadEvent::Finished,
            ),
            Some("session-b".to_string()),
        );
    }

    #[test]
    fn tab_context_menu_overlay_uses_private_bridge_and_preserves_disabled_items() {
        let theme = BrowserTabContextMenuTheme {
            color_scheme: "light".to_string(),
            surface: "theme-surface".to_string(),
            foreground: "theme-foreground".to_string(),
            border: "theme-border".to_string(),
            hover_surface: "theme-hover".to_string(),
            disabled_foreground: "theme-disabled".to_string(),
            shadow: "theme-shadow".to_string(),
        };
        let script = browser_tab_context_menu_overlay_script(
            "session-42",
            "menu-nonce-42",
            88.0,
            Some("zh-CN"),
            &["right".to_string()],
            &theme,
        )
        .expect("overlay script should serialize");

        assert!(script.contains(BROWSER_TAB_CONTEXT_MENU_BRIDGE_HOST));
        assert!(script.contains(BROWSER_TAB_CONTEXT_MENU_BRIDGE_PATH));
        assert!(script.contains("关闭标签页"));
        assert!(script.contains("left:min(88px"));
        assert!(script.contains("top:16px"));
        assert!(script.contains("button.disabled = disabled"));
        assert!(script.contains("[\"right\",\"关闭右侧标签页\",true]"));
        assert!(script.contains("\"surface\":\"theme-surface\""));
        assert!(script.contains("--mossx-tab-menu-surface"));
        assert!(script.contains("attachShadow({ mode: \"closed\" })"));
        assert!(script.contains("event.composedPath().includes(host)"));
        assert!(script.contains("&nonce="));
        assert!(script.contains("menu-nonce-42"));
        assert!(!script.contains("#111318"));
    }

    #[test]
    fn tab_context_menu_invocation_is_scoped_expiring_and_one_time() {
        let issued_at = 100_u64;
        let invocation = BrowserTabContextMenuInvocation::new("target-b", "renderer-a", issued_at);
        let nonce = invocation.nonce.clone();

        assert!(invocation.authorizes(
            nonce.as_str(),
            "target-b",
            "renderer-a",
            issued_at + BROWSER_TAB_CONTEXT_MENU_BRIDGE_TTL_MS,
        ));
        assert!(!invocation.authorizes(nonce.as_str(), "target-c", "renderer-a", issued_at + 1,));
        assert!(!invocation.authorizes(nonce.as_str(), "target-b", "renderer-c", issued_at + 1,));
        assert!(!invocation.authorizes(
            nonce.as_str(),
            "target-b",
            "renderer-a",
            issued_at + BROWSER_TAB_CONTEXT_MENU_BRIDGE_TTL_MS + 1,
        ));
        assert!(!invocation.authorizes(nonce.as_str(), "target-b", "renderer-a", issued_at - 1,));

        let mut active_invocation = Some(invocation);
        assert!(consume_tab_context_menu_invocation(
            &mut active_invocation,
            nonce.as_str(),
            "target-b",
            "renderer-a",
            issued_at + 1,
        ));
        assert!(active_invocation.is_none());
        assert!(!consume_tab_context_menu_invocation(
            &mut active_invocation,
            nonce.as_str(),
            "target-b",
            "renderer-a",
            issued_at + 2,
        ));
    }

    #[test]
    fn user_override_blocks_builtin_provider() {
        let settings = BrowserAgentSettings {
            enabled: true,
            ..BrowserAgentSettings::default()
        };
        let decision = default_route_decision(
            "read_snapshot",
            &settings,
            true,
            &platform::current_platform_capability(),
        );
        assert_eq!(decision.selected_provider, "browser_skill");
        assert!(decision.fallback_used);
        assert_eq!(decision.fallback_reason.as_deref(), Some("user_override"));
    }

    #[test]
    fn snapshot_summary_uses_bounded_visible_text() {
        let snapshot = BrowserContextSnapshot {
            snapshot_id: "snapshot-1".to_string(),
            browser_session_id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            captured_at: 100,
            freshness: BrowserSnapshotFreshness::Fresh,
            source: BrowserSnapshotSource {
                url: "https://example.com".to_string(),
                normalized_url: "https://example.com".to_string(),
                origin: Some("https://example.com".to_string()),
                title: Some("Example".to_string()),
                tab_label: "Example".to_string(),
                capture_reason: "manual_attach".to_string(),
                workspace_local_allowed: false,
            },
            viewport: default_browser_viewport(),
            page: BrowserContextSnapshotPage {
                visible_text: "first line\nsecond line".to_string(),
                page_type: BrowserPageType::Unknown,
                primary_content: None,
                readable_blocks: Vec::new(),
                noise_diagnostics: Vec::new(),
                visual_evidence: Vec::new(),
                text_truncated: false,
                headings: Vec::new(),
                landmarks: Vec::new(),
                element_landmarks: Vec::new(),
                content_regions: Vec::new(),
                links: Vec::new(),
                buttons: Vec::new(),
                forms: Vec::new(),
                selected_text: None,
                language_hint: None,
            },
            code_candidates: Vec::new(),
            diagnostics: BrowserContextSnapshotDiagnostics {
                console: Vec::new(),
                network: None,
                capture_warnings: Vec::new(),
            },
            evidence: BrowserContextSnapshotEvidence {
                screenshot_ref: None,
                html_excerpt_ref: None,
            },
            omitted_capabilities: Vec::new(),
            privacy: BrowserPrivacyReport {
                redaction_applied: false,
                redacted_kinds: Vec::new(),
                omitted_kinds: Vec::new(),
            },
            budget: BrowserSnapshotBudget {
                char_limit: 12_000,
                visible_text_limit: 8_000,
                element_limit: 120,
                form_field_limit: 80,
                diagnostic_limit: 50,
                token_estimate: None,
                truncated: false,
                omitted_element_count: 0,
            },
            availability: "available".to_string(),
        };

        assert_eq!(
            snapshot_summary(&snapshot),
            "Example\nfirst line second line"
        );
    }
