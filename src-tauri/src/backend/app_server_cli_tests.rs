    use super::*;
    use std::fs;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(unix)]
    use std::os::unix::fs::{symlink, PermissionsExt};

    #[test]
    fn npm_prefix_resolution_uses_bin_on_unix() {
        #[cfg(not(windows))]
        {
            let resolved =
                resolve_npm_global_bin_dir_from_prefix("/Users/demo/.npm-global").unwrap();
            assert_eq!(resolved, PathBuf::from("/Users/demo/.npm-global/bin"));
        }
    }

    #[test]
    fn npm_prefix_resolution_ignores_empty_values() {
        assert!(resolve_npm_global_bin_dir_from_prefix("").is_none());
        assert!(resolve_npm_global_bin_dir_from_prefix("undefined").is_none());
        assert!(resolve_npm_global_bin_dir_from_prefix("null").is_none());
    }

    #[test]
    fn launch_context_uses_command_wrapper_only_for_windows_launch_wrappers() {
        let direct = CodexLaunchContext {
            resolved_bin: "codex".to_string(),
            wrapper_kind: wrapper_kind_for_binary("codex"),
            path_env: None,
        };
        let cmd_wrapper = CodexLaunchContext {
            resolved_bin: "C:/Users/demo/AppData/Roaming/npm/codex.cmd".to_string(),
            wrapper_kind: wrapper_kind_for_binary("C:/Users/demo/AppData/Roaming/npm/codex.cmd"),
            path_env: None,
        };
        let bat_wrapper = CodexLaunchContext {
            resolved_bin: "C:/tools/codex.bat".to_string(),
            wrapper_kind: wrapper_kind_for_binary("C:/tools/codex.bat"),
            path_env: None,
        };
        let ps1_wrapper = CodexLaunchContext {
            resolved_bin: "C:/tools/codex.ps1".to_string(),
            wrapper_kind: wrapper_kind_for_binary("C:/tools/codex.ps1"),
            path_env: None,
        };
        let exe_binary = CodexLaunchContext {
            resolved_bin: "C:/tools/codex.exe".to_string(),
            wrapper_kind: wrapper_kind_for_binary("C:/tools/codex.exe"),
            path_env: None,
        };

        assert!(!launch_context_uses_command_wrapper(&direct));
        assert!(launch_context_uses_command_wrapper(&cmd_wrapper));
        assert!(launch_context_uses_command_wrapper(&bat_wrapper));
        assert!(launch_context_uses_command_wrapper(&ps1_wrapper));
        assert!(!launch_context_uses_command_wrapper(&exe_binary));
    }

    #[test]
    fn prefer_windows_executable_variant_prefers_stable_wrapper_before_ps1() {
        let root =
            std::env::temp_dir().join(format!("ccgui-wrapper-preference-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let base = root.join("claude");
        let cmd_path = root.join("claude.cmd");
        let exe_path = root.join("claude.exe");
        let ps1_path = root.join("claude.ps1");
        std::fs::write(&ps1_path, "").expect("write ps1");
        std::fs::write(&exe_path, "").expect("write exe");
        std::fs::write(&cmd_path, "").expect("write cmd");

        assert_eq!(prefer_windows_executable_variant(base), cmd_path);
        assert_eq!(
            prefer_windows_executable_variant(ps1_path.clone()),
            ps1_path
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn resolve_launchable_cli_prefers_cmd_over_posix_shim() {
        let root =
            std::env::temp_dir().join(format!("ccgui-dsh-posix-shim-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let posix_shim = root.join("dsh");
        let cmd_path = root.join("dsh.cmd");
        std::fs::write(&posix_shim, "#!/bin/sh\n").expect("write posix shim");
        std::fs::write(&cmd_path, "@echo off\n").expect("write cmd wrapper");

        assert_eq!(
            PathBuf::from(resolve_launchable_cli_binary(
                posix_shim.to_string_lossy().as_ref()
            )),
            cmd_path
        );
        assert_eq!(
            resolve_launchable_cli_binary(r"C:\definitely\missing\dsh"),
            r"C:\definitely\missing\dsh"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn check_cli_binary_resolves_bare_dsh_name_to_cmd_wrapper() {
        let Some(found) = find_cli_binary("dsh", None) else {
            return;
        };
        let is_cmd = found
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("cmd"));
        if !is_cmd {
            return;
        }

        let resolved = resolve_launchable_cli_binary("dsh");
        assert!(
            resolved.to_ascii_lowercase().ends_with("dsh.cmd"),
            "bare dsh name should resolve to the npm .cmd wrapper, got {resolved}"
        );
        let launch_context = resolve_codex_launch_context(Some("dsh"));
        assert_eq!(launch_context.wrapper_kind, "cmd-wrapper");
        let version = check_cli_binary("dsh", None)
            .await
            .expect("dsh.cmd --version should launch on Windows");
        assert!(
            version
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty()),
            "expected a DSH version string, got {version:?}"
        );
    }

    #[test]
    fn resolve_codex_binary_does_not_fallback_to_claude_name() {
        let launch_context = resolve_codex_launch_context(None);
        let file_name = Path::new(&launch_context.resolved_bin)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(launch_context.resolved_bin.as_str())
            .to_ascii_lowercase();
        assert_ne!(file_name, "claude");
    }

    #[tokio::test]
    async fn check_codex_installation_missing_error_is_codex_specific() {
        let error = check_codex_installation(Some("/definitely/missing/codex".to_string()))
            .await
            .expect_err("missing custom Codex binary should fail");

        assert!(error.contains("Codex CLI"));
        assert!(!error.contains("Claude Code"));
    }

    #[test]
    fn wrapper_compatibility_retry_is_platform_gated() {
        let direct = CodexLaunchContext {
            resolved_bin: "codex".to_string(),
            wrapper_kind: wrapper_kind_for_binary("codex"),
            path_env: None,
        };
        let cmd_wrapper = CodexLaunchContext {
            resolved_bin: "C:/Users/demo/AppData/Roaming/npm/codex.cmd".to_string(),
            wrapper_kind: wrapper_kind_for_binary("C:/Users/demo/AppData/Roaming/npm/codex.cmd"),
            path_env: None,
        };

        assert!(!can_retry_wrapper_compatibility_launch(&direct));
        #[cfg(windows)]
        assert!(can_retry_wrapper_compatibility_launch(&cmd_wrapper));
        #[cfg(not(windows))]
        assert!(!can_retry_wrapper_compatibility_launch(&cmd_wrapper));
    }

    #[test]
    fn app_server_primary_args_append_internal_spec_hint() {
        let args = build_codex_app_server_args(
            Some("--profile work"),
            CodexAppServerLaunchOptions::primary_for_platform(false),
        )
        .expect("build args");

        assert_eq!(args.first().map(String::as_str), Some("--profile"));
        assert_eq!(args.get(1).map(String::as_str), Some("work"));
        assert!(args.iter().any(|arg| arg == "-c"));
        assert!(args.iter().any(|arg| {
            arg.starts_with("developer_instructions=\"") && arg.contains("writableRoots")
        }));
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[test]
    fn app_server_primary_args_respect_user_instruction_override() {
        let args = build_codex_app_server_args(
            Some(r#"-c developer_instructions="follow workspace policy""#),
            CodexAppServerLaunchOptions::primary_for_platform(false),
        )
        .expect("build args");

        assert_eq!(args.iter().filter(|arg| arg.as_str() == "-c").count(), 1);
        assert!(!args.iter().any(|arg| arg.contains("writableRoots")));
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[test]
    fn app_server_wrapper_retry_args_skip_internal_spec_hint_but_keep_user_args() {
        let args = build_codex_app_server_args(
            Some("--profile work --sandbox read-only"),
            CodexAppServerLaunchOptions::wrapper_compatibility_retry(),
        )
        .expect("build args");

        assert_eq!(
            args,
            vec![
                "--profile".to_string(),
                "work".to_string(),
                "--sandbox".to_string(),
                "read-only".to_string(),
                "app-server".to_string(),
            ]
        );
    }

    #[test]
    fn app_server_session_hooks_disabled_args_keep_primary_shape() {
        let options = CodexAppServerLaunchOptions::session_hooks_disabled_for_platform(false);
        let args =
            build_codex_app_server_args(Some("--profile work"), options).expect("build args");

        assert_eq!(
            options.launch_mode,
            CodexAppServerLaunchMode::SessionHooksDisabled
        );
        assert_eq!(options.hide_console, true);
        assert!(args.iter().any(|arg| {
            arg.starts_with("developer_instructions=\"") && arg.contains("writableRoots")
        }));
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[test]
    fn app_server_windows_session_hooks_disabled_omits_generated_instructions_argv() {
        let options = CodexAppServerLaunchOptions::session_hooks_disabled_for_platform(true);
        let args =
            build_codex_app_server_args(Some("--profile work"), options).expect("build args");

        assert_eq!(
            options.launch_mode,
            CodexAppServerLaunchMode::SessionHooksDisabled
        );
        assert_eq!(
            options.generated_instructions_transport,
            CodexGeneratedInstructionsTransport::OmitForWrapperRecovery
        );
        assert!(!args.iter().any(|arg| arg.contains("writableRoots")));
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[test]
    fn app_server_session_hooks_disabled_wrapper_retry_preserves_hook_safe_mode() {
        let options = CodexAppServerLaunchOptions::wrapper_compatibility_retry_for_mode(
            CodexAppServerLaunchMode::SessionHooksDisabled,
        );
        let args =
            build_codex_app_server_args(Some("--profile work"), options).expect("build args");

        assert_eq!(
            options.launch_mode,
            CodexAppServerLaunchMode::SessionHooksDisabled
        );
        assert_eq!(
            options.generated_instructions_transport,
            CodexGeneratedInstructionsTransport::OmitForWrapperRecovery
        );
        assert!(!args.iter().any(|arg| arg.contains("writableRoots")));
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[test]
    fn custom_bin_parent_resolution_handles_macos_and_windows_style_paths() {
        let macos_paths = build_seed_search_paths(Some("/Users/demo/.npm-global/bin/codex"), &[]);
        assert!(macos_paths
            .iter()
            .any(|path| path == Path::new("/Users/demo/.npm-global/bin")));

        let windows_paths =
            build_seed_search_paths(Some("C:/Users/demo/AppData/Roaming/npm/codex.cmd"), &[]);
        assert!(windows_paths.iter().any(|path| {
            path.to_string_lossy()
                .replace('\\', "/")
                .ends_with("C:/Users/demo/AppData/Roaming/npm")
        }));
        assert_eq!(
            wrapper_kind_for_binary(r"C:\Users\demo\AppData\Roaming\npm\codex.cmd"),
            "cmd-wrapper"
        );
        assert_eq!(
            wrapper_kind_for_binary(r"C:\Users\demo\AppData\Roaming\npm\codex.exe"),
            "exe-binary"
        );
        assert_eq!(
            wrapper_kind_for_binary(r"C:\Users\demo\AppData\Roaming\npm\codex.ps1"),
            "ps1-wrapper"
        );
    }

    #[test]
    fn generic_cli_path_env_keeps_custom_parent_and_codex_compatibility() {
        let custom_bin = "/Users/demo/.npm-global/bin/jdtls";
        let generic_path = build_cli_path_env(Some(custom_bin)).expect("generic PATH");
        let paths = env::split_paths(&OsString::from(&generic_path)).collect::<Vec<_>>();

        assert!(paths
            .iter()
            .any(|path| path == Path::new("/Users/demo/.npm-global/bin")));
        assert_eq!(build_codex_path_env(Some(custom_bin)), Some(generic_path));
    }

    #[test]
    fn bare_cli_name_does_not_add_an_empty_path_entry() {
        let paths = build_seed_search_paths(Some("jdtls"), &[]);

        assert!(paths.iter().all(|path| !path.as_os_str().is_empty()));
    }

    #[test]
    fn proxy_diagnosis_reports_redacted_process_proxy_evidence() {
        let mut snapshot = serde_json::Map::new();
        snapshot.insert(
            "HTTPS_PROXY".to_string(),
            json!(redact_proxy_env_value(
                "HTTPS_PROXY",
                "https://user:secret@proxy.example:8080".to_string()
            )),
        );
        snapshot.insert("NO_PROXY".to_string(), json!("localhost,127.0.0.1"));

        let diagnosis = build_proxy_diagnosis(&snapshot);

        assert_eq!(diagnosis["category"], "proxyConfigured");
        assert_eq!(diagnosis["primarySource"], "processEnv");
        assert_eq!(
            snapshot["HTTPS_PROXY"],
            "https://[redacted]@proxy.example:8080"
        );
        assert_eq!(snapshot["NO_PROXY"], "localhost,127.0.0.1");
    }

    #[test]
    fn environment_diagnosis_classifies_gui_path_drift() {
        let debug_info = json!({
            "resolvedBinaryPath": "/opt/homebrew/bin/codex",
            "codexFound": "/opt/homebrew/bin/codex",
            "codexStandardWhich": null,
        });

        let diagnosis = build_engine_environment_diagnosis("codex", None, &debug_info);

        assert_eq!(diagnosis["category"], "environmentDrift");
        assert_eq!(diagnosis["missedByGuiPath"], true);
        assert_eq!(diagnosis["fallbackBinary"], "/opt/homebrew/bin/codex");
    }

    #[test]
    fn environment_diagnosis_prioritizes_missing_configured_path() {
        let debug_info = json!({
            "resolvedBinaryPath": "/opt/homebrew/bin/codex",
            "codexFound": "/opt/homebrew/bin/codex",
            "codexStandardWhich": null,
        });

        let diagnosis = build_engine_environment_diagnosis(
            "codex",
            Some("/definitely/missing/codex"),
            &debug_info,
        );

        assert_eq!(diagnosis["category"], "configuredPathMissing");
        assert_eq!(diagnosis["configuredPathMissing"], true);
    }

    #[test]
    fn endpoint_failure_classifier_maps_actionable_categories() {
        assert_eq!(
            classify_endpoint_failure(Some("Timed out while checking endpoint")),
            "timeout"
        );
        assert_eq!(
            classify_endpoint_failure(Some("DNS lookup failed")),
            "dnsFailure"
        );
        assert_eq!(
            classify_endpoint_failure(Some("TLS certificate rejected")),
            "tlsFailure"
        );
        assert_eq!(
            classify_endpoint_failure(Some("Proxy returned 407")),
            "proxyUnreachable"
        );
        assert_eq!(
            classify_endpoint_failure(Some("HTTP status 500")),
            "httpStatus"
        );
    }

    #[test]
    fn app_server_spawn_args_preserve_shell_sensitive_values_as_arg_array() {
        let launch_context = CodexLaunchContext {
            resolved_bin: "codex".to_string(),
            wrapper_kind: "direct",
            path_env: None,
        };
        let mut command = build_codex_command_from_launch_context(&launch_context, true);
        apply_codex_app_server_args(
            &mut command,
            Some(r#"--cd "C:/Users/demo/project with spaces" -c model="gpt-5" --note "a && b; c""#),
            CodexAppServerLaunchOptions::wrapper_compatibility_retry(),
        )
        .expect("apply app-server args");

        let args = command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert_eq!(
            args,
            vec![
                "--cd".to_string(),
                "C:/Users/demo/project with spaces".to_string(),
                "-c".to_string(),
                "model=gpt-5".to_string(),
                "--note".to_string(),
                "a && b; c".to_string(),
                "app-server".to_string(),
            ]
        );
    }

    #[cfg(unix)]
    fn write_unix_test_cli(script_body: &str) -> PathBuf {
        let unique = format!(
            "ccgui-cli-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let dir = env::temp_dir().join(unique);
        fs::create_dir_all(&dir).expect("create temp cli dir");
        let script_path = dir.join("codex-test-cli");
        fs::write(&script_path, script_body).expect("write temp cli script");
        let mut permissions = fs::metadata(&script_path)
            .expect("stat temp cli script")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script_path, permissions).expect("chmod temp cli script");
        script_path
    }

    /// refactor-engine-detection-pipeline B2：TTL 内重复获取额外搜索路径
    /// MUST 复用缓存（`npm config get prefix` 每进程至多 1 次）。
    #[test]
    fn extra_search_paths_cache_reuses_result_within_ttl() {
        let _guard = ENV_CACHE_TEST_LOCK.lock().expect("env cache test lock");
        ENV_CACHE_TTL_OVERRIDE_MS.store(600_000, AtomicOrdering::SeqCst);
        invalidate_environment_resolution_caches();
        // warm up：持锁窗口内全进程进入确定的热缓存态（此后任何测试的
        // cached 调用都是 cache-hit，零 spawn）。
        let _ = cached_extra_search_paths();

        let before = NPM_PREFIX_PROBE_SPAWN_COUNT.load(AtomicOrdering::SeqCst);
        let first = cached_extra_search_paths();
        let middle = NPM_PREFIX_PROBE_SPAWN_COUNT.load(AtomicOrdering::SeqCst);
        let second = cached_extra_search_paths();
        let after = NPM_PREFIX_PROBE_SPAWN_COUNT.load(AtomicOrdering::SeqCst);

        assert_eq!(first, second, "cached result must be identical");
        assert_eq!(
            middle, before,
            "call within TTL must not spawn `npm config get prefix`"
        );
        assert_eq!(
            after, middle,
            "repeated calls within TTL must not spawn again"
        );

        invalidate_environment_resolution_caches();
        ENV_CACHE_TTL_OVERRIDE_MS.store(0, AtomicOrdering::SeqCst);
    }

    /// refactor-engine-detection-pipeline B2：失效后允许重新解析（覆盖用户刚
    /// 装好 CLI 的场景）。
    #[test]
    fn invalidate_environment_resolution_caches_clears_hot_entries() {
        let _guard = ENV_CACHE_TEST_LOCK.lock().expect("env cache test lock");
        ENV_CACHE_TTL_OVERRIDE_MS.store(600_000, AtomicOrdering::SeqCst);
        let _ = cached_extra_search_paths();
        invalidate_environment_resolution_caches();

        let before = NPM_PREFIX_PROBE_SPAWN_COUNT.load(AtomicOrdering::SeqCst);
        let _ = cached_extra_search_paths();
        let after = NPM_PREFIX_PROBE_SPAWN_COUNT.load(AtomicOrdering::SeqCst);
        assert!(
            after > before,
            "after invalidation the next resolution must re-resolve (re-probe npm prefix)"
        );
        invalidate_environment_resolution_caches();
        ENV_CACHE_TTL_OVERRIDE_MS.store(0, AtomicOrdering::SeqCst);
    }

    /// refactor-engine-detection-pipeline B2：登录 shell 解析结果 TTL 内复用
    /// （`$SHELL -lic` 每进程至多 1 次）。
    #[cfg(unix)]
    #[test]
    fn claude_login_shell_resolution_is_cached_within_ttl() {
        let _guard = ENV_CACHE_TEST_LOCK.lock().expect("env cache test lock");
        ENV_CACHE_TTL_OVERRIDE_MS.store(600_000, AtomicOrdering::SeqCst);
        invalidate_environment_resolution_caches();
        let _ = resolve_claude_via_login_shell();

        let before = CLAUDE_LOGIN_SHELL_SPAWN_COUNT.load(AtomicOrdering::SeqCst);
        let first = resolve_claude_via_login_shell();
        let middle = CLAUDE_LOGIN_SHELL_SPAWN_COUNT.load(AtomicOrdering::SeqCst);
        let second = resolve_claude_via_login_shell();
        let after = CLAUDE_LOGIN_SHELL_SPAWN_COUNT.load(AtomicOrdering::SeqCst);

        assert_eq!(first, second);
        assert_eq!(
            middle, before,
            "resolution within TTL must not spawn `$SHELL -lic`"
        );
        assert_eq!(
            after, middle,
            "repeated resolutions within TTL must not spawn again"
        );
        invalidate_environment_resolution_caches();
        ENV_CACHE_TTL_OVERRIDE_MS.store(0, AtomicOrdering::SeqCst);
    }

    /// refactor-engine-detection-pipeline B2：Claude 候选验证出的版本在 TTL 内
    /// 经 memo 复用（消费端契约；同轮 detect 不再二次 `claude --version`）。
    #[cfg(unix)]
    #[test]
    fn claude_version_memo_reuses_recent_probe_result() {
        ENV_CACHE_TTL_OVERRIDE_MS.store(600_000, AtomicOrdering::SeqCst);
        let fake = write_unix_test_cli("#!/bin/sh\necho '1.2.3 (Claude Code)'\n");
        invalidate_environment_resolution_caches();

        let probed = probe_claude_version_text(&fake);
        assert_eq!(probed.as_deref(), Some("1.2.3 (Claude Code)"));

        let cached = claude_cached_version_text(&fake);
        assert_eq!(
            cached.as_deref(),
            Some("1.2.3 (Claude Code)"),
            "recent probe result must be readable from the memo"
        );

        invalidate_environment_resolution_caches();
        assert_eq!(
            claude_cached_version_text(&fake),
            None,
            "invalidation must clear the memo"
        );
        ENV_CACHE_TTL_OVERRIDE_MS.store(0, AtomicOrdering::SeqCst);
        let _ = fs::remove_file(&fake);
        let _ = fs::remove_dir_all(fake.parent().unwrap_or(Path::new("")));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn check_cli_binary_accepts_help_fallback_when_version_fails() {
        let script_path = write_unix_test_cli(
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo 'broken version' >&2\n  exit 1\nfi\nif [ \"$1\" = \"--help\" ]; then\n  echo 'usage'\n  exit 0\nfi\nexit 1\n",
        );

        let result = check_cli_binary(script_path.to_string_lossy().as_ref(), None).await;
        assert_eq!(result.expect("help fallback should pass"), None);

        let _ = fs::remove_file(&script_path);
        let _ = fs::remove_dir_all(script_path.parent().unwrap_or(Path::new("")));
    }

    #[test]
    fn matching_custom_bin_only_applies_to_same_cli_name() {
        assert_eq!(
            matching_custom_bin(Some("/tmp/codex.cmd"), "codex"),
            Some("/tmp/codex.cmd")
        );
        assert_eq!(matching_custom_bin(Some("/tmp/codex.cmd"), "claude"), None);
        assert_eq!(
            matching_custom_bin(Some("/tmp/Claude"), "claude"),
            Some("/tmp/Claude")
        );
        assert_eq!(matching_custom_bin(Some(""), "claude"), None);
    }

    #[test]
    fn windows_extra_search_paths_include_user_local_bin() {
        let paths = build_windows_extra_search_paths(
            Some(Path::new("C:\\Users\\Administrator\\AppData\\Roaming")),
            Some(Path::new("C:\\Users\\Administrator")),
            Some(Path::new("C:\\Users\\Administrator\\AppData\\Local")),
            Some(Path::new("C:\\Program Files")),
            Some(Path::new("C:\\Program Files (x86)")),
        );

        let normalized: Vec<String> = paths
            .iter()
            .map(|path| path.to_string_lossy().replace('/', "\\"))
            .collect();
        for expected in [
            "C:\\Users\\Administrator\\.local\\bin",
            "C:\\Users\\Administrator\\.hermes\\node",
            "C:\\Users\\Administrator\\.hermes\\node\\bin",
            "C:\\Users\\Administrator\\.qoder\\bin\\qodercli",
            "C:\\Users\\Administrator\\.local\\share\\mise\\shims",
            "C:\\Users\\Administrator\\scoop\\shims",
            "C:\\Users\\Administrator\\scoop\\apps\\nodejs\\current",
            "C:\\Users\\Administrator\\AppData\\Local\\hermes\\node",
            "C:\\Users\\Administrator\\AppData\\Local\\mise\\shims",
        ] {
            assert!(
                normalized.iter().any(|path| path == expected),
                "expected Windows CLI search paths to include {expected}, got {normalized:?}"
            );
        }
    }

    #[test]
    fn windows_opencode_cmd_wrapper_is_considered_background_safe() {
        let path = Path::new("C:\\Users\\demo\\AppData\\Roaming\\npm\\opencode.cmd");
        assert!(is_windows_background_safe_opencode_candidate(path));
    }

    #[test]
    fn windows_opencode_cli_exe_in_known_cli_root_is_background_safe() {
        let path = Path::new("C:\\Users\\demo\\.cargo\\bin\\opencode.exe");
        assert!(is_windows_background_safe_opencode_candidate(path));
    }

    #[test]
    fn windows_opencode_launcher_exe_outside_cli_roots_is_rejected() {
        let path = Path::new("C:\\Users\\demo\\AppData\\Local\\Programs\\OpenCode\\opencode.exe");
        assert!(!is_windows_background_safe_opencode_candidate(path));
    }

    #[cfg(unix)]
    #[test]
    fn discover_npm_global_bin_dir_from_npm_uses_reported_prefix_and_finds_codex() {
        let unique = format!(
            "ccgui-npm-prefix-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let root = env::temp_dir().join(unique);
        let fake_npm = root.join("npm");
        let prefix_dir = root.join("custom-prefix");
        let prefix_bin = prefix_dir.join("bin");
        let codex_path = prefix_bin.join("codex");

        fs::create_dir_all(&prefix_bin).expect("create prefix/bin");

        {
            let mut npm_file = fs::File::create(&fake_npm).expect("create fake npm");
            writeln!(
                npm_file,
                "#!/bin/sh\nif [ \"$1\" = \"config\" ] && [ \"$2\" = \"get\" ] && [ \"$3\" = \"prefix\" ]; then\n  printf '{}\\n'\n  exit 0\nfi\nexit 1",
                prefix_dir.to_string_lossy()
            )
            .expect("write fake npm");
        }

        {
            let mut codex_file = fs::File::create(&codex_path).expect("create fake codex");
            writeln!(codex_file, "#!/bin/sh\nexit 0").expect("write fake codex");
        }

        for path in [&fake_npm, &codex_path] {
            let mut permissions = fs::metadata(path)
                .expect("stat fake executable")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).expect("chmod fake executable");
        }

        let resolved = discover_npm_global_bin_dir_from_npm(&[], Some(fake_npm.as_path()))
            .expect("resolve npm prefix");
        assert_eq!(resolved, prefix_bin);

        let joined_paths = env::join_paths([resolved.clone()]).expect("join search paths");
        let cwd = env::current_dir().expect("current dir");
        let found = which::which_in("codex", Some(&joined_paths), &cwd).expect("find codex");
        assert_eq!(found, codex_path);

        let _ = fs::remove_file(&fake_npm);
        let _ = fs::remove_file(&codex_path);
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn discover_npm_global_bin_dir_prefers_symlinked_npm_runtime() {
        let unique = format!(
            "ccgui-symlinked-npm-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let root = env::temp_dir().join(unique);
        let launcher_bin = root.join("launcher-bin");
        let runtime_bin = root.join("runtime-bin");
        let competing_bin = root.join("competing-bin");
        let expected_prefix = root.join("expected-prefix");
        let competing_prefix = root.join("competing-prefix");
        let runtime_npm = runtime_bin.join("npm");
        let linked_npm = launcher_bin.join("npm");
        let runtime_node = runtime_bin.join("node");
        let competing_node = competing_bin.join("node");
        let npm_cli = runtime_bin.join("../lib/node_modules/npm/bin/npm-cli.js");

        for directory in [
            launcher_bin.as_path(),
            runtime_bin.as_path(),
            competing_bin.as_path(),
            npm_cli.parent().expect("npm cli parent"),
        ] {
            fs::create_dir_all(directory).expect("create test bin directory");
        }
        fs::write(&npm_cli, "#!/usr/bin/env node\n").expect("write npm cli");
        fs::write(
            &runtime_node,
            format!("#!/bin/sh\nprintf '{}\\n'\n", expected_prefix.display()),
        )
        .expect("write matching node runtime");
        fs::write(
            &competing_node,
            format!("#!/bin/sh\nprintf '{}\\n'\n", competing_prefix.display()),
        )
        .expect("write competing node runtime");

        for executable in [&npm_cli, &runtime_node, &competing_node] {
            let mut permissions = fs::metadata(executable)
                .expect("stat test executable")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(executable, permissions).expect("chmod test executable");
        }
        symlink("../lib/node_modules/npm/bin/npm-cli.js", &runtime_npm)
            .expect("create runtime npm symlink");
        symlink(&runtime_npm, &linked_npm).expect("create launcher npm symlink");

        let resolved = discover_npm_global_bin_dir_from_npm(
            std::slice::from_ref(&competing_bin),
            Some(linked_npm.as_path()),
        )
        .expect("resolve symlinked npm prefix");

        assert_eq!(resolved, expected_prefix.join("bin"));
        let probe_paths = build_npm_probe_paths(&[competing_bin], &linked_npm);
        assert_eq!(probe_paths.first(), Some(&launcher_bin));
        assert!(probe_paths.iter().any(|path| path == &runtime_bin));

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn npm_launcher_discovery_includes_secondary_runtime_provider() {
        let unique = format!(
            "ccgui-multi-npm-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let root = env::temp_dir().join(unique);
        let primary_bin = root.join("primary/bin");
        let secondary_launcher_bin = root.join("secondary-launcher");
        let secondary_runtime_bin = root.join("secondary-runtime/bin");
        let secondary_npm_cli = root.join("secondary-runtime/lib/npm/npm-cli.js");
        let secondary_runtime_npm = secondary_runtime_bin.join("npm");
        let secondary_launcher_npm = secondary_launcher_bin.join("npm");
        let pyright = secondary_runtime_bin.join("pyright-langserver");

        for directory in [
            primary_bin.as_path(),
            secondary_launcher_bin.as_path(),
            secondary_runtime_bin.as_path(),
            secondary_npm_cli
                .parent()
                .expect("secondary npm cli parent"),
        ] {
            fs::create_dir_all(directory).expect("create multi-runtime test directory");
        }
        fs::write(primary_bin.join("npm"), "#!/bin/sh\nexit 0\n").expect("write primary npm");
        fs::write(&secondary_npm_cli, "#!/usr/bin/env node\n").expect("write secondary npm cli");
        fs::write(&pyright, "#!/bin/sh\nexit 0\n").expect("write secondary provider");
        symlink("../lib/npm/npm-cli.js", &secondary_runtime_npm)
            .expect("create secondary runtime npm symlink");
        symlink(&secondary_runtime_npm, &secondary_launcher_npm)
            .expect("create secondary launcher npm symlink");

        for executable in [primary_bin.join("npm"), secondary_npm_cli, pyright.clone()] {
            let mut permissions = fs::metadata(&executable)
                .expect("stat multi-runtime executable")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&executable, permissions).expect("chmod multi-runtime executable");
        }

        let discovered = discover_npm_launcher_search_paths(&[
            primary_bin.clone(),
            secondary_launcher_bin.clone(),
        ]);
        assert!(discovered.iter().any(|path| path == &primary_bin));
        assert!(discovered.iter().any(|path| path == &secondary_runtime_bin));

        let joined_paths = env::join_paths(&discovered).expect("join discovered npm paths");
        let cwd = env::current_dir().expect("current dir");
        let found = which::which_in("pyright-langserver", Some(&joined_paths), &cwd)
            .expect("find provider from secondary runtime");
        assert_eq!(found, pyright);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn npm_launcher_names_cover_unix_and_windows_wrappers() {
        assert_eq!(npm_launcher_file_names(false), &["npm"]);
        assert_eq!(
            npm_launcher_file_names(true),
            &["npm.cmd", "npm.exe", "npm.bat", "npm.ps1", "npm"]
        );
    }
