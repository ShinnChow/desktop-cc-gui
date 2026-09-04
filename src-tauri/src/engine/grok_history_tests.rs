use super::{
    file_mtime_millis, first_user_prompt_from_line, first_user_prompt_text,
    is_grok_runtime_context_user_text, matches_workspace_path,
    parse_grok_user_prompt_for_display, parse_messages_from_chat_history,
    parse_timestamp_millis, prepare_grok_history_line_for_parse,
    resolve_session_activity_millis, strip_user_query_wrapper, url_decode_dir_name,
    url_encode_dir_name, GROK_OMITTED_PAYLOAD_SENTINEL, GROK_TOOL_OUTPUT_CHAR_BUDGET,
};
use std::path::Path;

#[test]
fn parses_user_assistant_reasoning_and_tool_lines() {
    let chat_history = concat!(
        "{\"type\":\"system\",\"content\":\"you are grok\"}\n",
        "{\"type\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"<system-reminder>ignore</system-reminder>\"}],\"synthetic_reason\":\"reminder\"}\n",
        "{\"type\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"<user_query>\\nfirst word of /tmp/test?\\n</user_query>\"}],\"prompt_index\":0}\n",
        "{\"type\":\"reasoning\",\"id\":\"r1\",\"summary\":\"user wants a file read\",\"encrypted_content\":\"...\",\"status\":\"done\"}\n",
        "{\"type\":\"assistant\",\"content\":\"Let me read it.\",\"tool_calls\":[{\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"Read\",\"arguments\":\"{\\\"path\\\":\\\"/tmp/test\\\"}\"}}],\"model_id\":\"grok-build\"}\n",
        "{\"type\":\"tool_result\",\"tool_call_id\":\"call_1\",\"content\":\"1→test file content\\n\"}\n",
        "{\"type\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"The first word is \"},{\"type\":\"text\",\"text\":\"test\"}],\"model_id\":\"grok-build\"}\n"
    );

    let result = parse_messages_from_chat_history(chat_history);

    assert_eq!(result.messages.len(), 6);
    assert_eq!(result.messages[0].role, "user");
    assert_eq!(result.messages[0].text, "first word of /tmp/test?");
    assert_eq!(result.messages[0].kind, "message");
    assert_eq!(result.messages[1].kind, "reasoning");
    assert_eq!(result.messages[1].text, "user wants a file read");
    assert_eq!(result.messages[2].kind, "message");
    assert_eq!(result.messages[2].text, "Let me read it.");
    assert_eq!(result.messages[3].kind, "tool");
    assert_eq!(result.messages[3].tool_type.as_deref(), Some("Read"));
    assert_eq!(result.messages[3].title.as_deref(), Some("Read"));
    assert_eq!(
        result.messages[3].tool_input,
        Some(serde_json::json!({"path": "/tmp/test"}))
    );
    assert_eq!(result.messages[4].id, "call_1-result");
    assert_eq!(result.messages[4].tool_type.as_deref(), Some("result"));
    assert_eq!(result.messages[4].text, "1→test file content\n");
    assert_eq!(result.messages[5].text, "The first word is \ntest");
    assert!(result.usage.is_none());
}

#[test]
fn parses_flat_tool_calls_with_top_level_name_and_arguments() {
    // Grok 4.5 / agent sessions use flat tool_calls (no nested `function`).
    let chat_history = concat!(
        "{\"type\":\"assistant\",\"content\":\"\",\"tool_calls\":[{\"id\":\"call-flat-1\",\"name\":\"read_file\",\"arguments\":\"{\\\"target_file\\\":\\\"src/a.ts\\\"}\"},{\"id\":\"call-flat-2\",\"name\":\"grep\",\"arguments\":{\"pattern\":\"foo\",\"path\":\"src\"}},{\"id\":\"call-flat-3\",\"name\":\"run_terminal_command\",\"arguments\":\"{\\\"command\\\":\\\"ls\\\"}\"}]}\n",
        "{\"type\":\"tool_result\",\"tool_call_id\":\"call-flat-1\",\"content\":\"file body\"}\n",
        "{\"type\":\"tool_result\",\"tool_call_id\":\"call-flat-2\",\"content\":\"match\"}\n"
    );

    let result = parse_messages_from_chat_history(chat_history);
    assert_eq!(result.messages.len(), 5);

    assert_eq!(result.messages[0].kind, "tool");
    assert_eq!(result.messages[0].id, "call-flat-1");
    assert_eq!(result.messages[0].tool_type.as_deref(), Some("read_file"));
    assert_eq!(result.messages[0].title.as_deref(), Some("read_file"));
    assert_eq!(
        result.messages[0].tool_input,
        Some(serde_json::json!({"target_file": "src/a.ts"}))
    );

    assert_eq!(result.messages[1].tool_type.as_deref(), Some("grep"));
    assert_eq!(result.messages[1].title.as_deref(), Some("grep"));
    assert_eq!(
        result.messages[1].tool_input,
        Some(serde_json::json!({"pattern": "foo", "path": "src"}))
    );

    assert_eq!(
        result.messages[2].tool_type.as_deref(),
        Some("run_terminal_command")
    );
    assert_eq!(
        result.messages[2].title.as_deref(),
        Some("run_terminal_command")
    );

    assert_eq!(result.messages[3].id, "call-flat-1-result");
    assert_eq!(result.messages[3].text, "file body");
    assert_eq!(result.messages[4].id, "call-flat-2-result");
    assert_eq!(result.messages[4].text, "match");
}

#[test]
fn drains_new_tool_signals_once_for_live_canvas_bridge() {
    use super::{drain_new_tool_signals_from_chat_history, GrokHistoryToolSignal};
    use std::collections::HashSet;
    let chat_history = concat!(
        "{\"type\":\"assistant\",\"content\":\"\",\"tool_calls\":[{\"id\":\"call_1\",\"name\":\"read_file\",\"arguments\":\"{\\\"target_file\\\":\\\"a.ts\\\"}\"}]}\n",
        "{\"type\":\"tool_result\",\"tool_call_id\":\"call_1\",\"content\":\"body\"}\n",
        "{\"type\":\"assistant\",\"content\":\"\",\"tool_calls\":[{\"id\":\"call_2\",\"name\":\"write_file\",\"arguments\":\"{\\\"path\\\":\\\"b.ts\\\"}\"}]}\n",
    );
    let mut seen_started = HashSet::new();
    let mut seen_completed = HashSet::new();
    let first = drain_new_tool_signals_from_chat_history(
        chat_history,
        &mut seen_started,
        &mut seen_completed,
    );
    assert_eq!(first.len(), 3);
    assert!(matches!(
        &first[0],
        GrokHistoryToolSignal::Started {
            tool_id,
            tool_name,
            ..
        } if tool_id == "call_1" && tool_name == "read_file"
    ));
    assert!(matches!(
        &first[1],
        GrokHistoryToolSignal::Completed { tool_id, .. } if tool_id == "call_1"
    ));
    assert!(matches!(
        &first[2],
        GrokHistoryToolSignal::Started {
            tool_id,
            tool_name,
            ..
        } if tool_id == "call_2" && tool_name == "write_file"
    ));
    let second = drain_new_tool_signals_from_chat_history(
        chat_history,
        &mut seen_started,
        &mut seen_completed,
    );
    assert!(second.is_empty(), "second drain must be idempotent");
}

#[test]
fn tool_history_tail_skips_baseline_then_reads_incrementally() {
    use super::{poll_chat_history_tool_signals, GrokHistoryToolSignal, GrokToolHistoryTailState};
    use std::io::Write;

    let dir = std::env::temp_dir().join(format!(
        "grok-tool-tail-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let path = dir.join("chat_history.jsonl");

    // Prior-turn tools already on disk.
    std::fs::write(
        &path,
        concat!(
            "{\"type\":\"assistant\",\"content\":\"\",\"tool_calls\":[{\"id\":\"old_1\",\"name\":\"read_file\",\"arguments\":\"{}\"}]}\n",
            "{\"type\":\"tool_result\",\"tool_call_id\":\"old_1\",\"content\":\"old\"}\n",
        ),
    )
    .expect("seed history");

    let mut state = GrokToolHistoryTailState::for_turn(true);
    let baseline = poll_chat_history_tool_signals(&path, &mut state).expect("baseline");
    assert!(
        baseline.is_empty(),
        "resume baseline must skip existing tools"
    );
    assert!(state.baseline_set);
    assert_eq!(state.byte_offset, std::fs::metadata(&path).unwrap().len());

    // New turn appends tools after baseline.
    {
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .expect("append");
        writeln!(
            file,
            "{{\"type\":\"assistant\",\"content\":\"\",\"tool_calls\":[{{\"id\":\"new_1\",\"name\":\"write_file\",\"arguments\":\"{{\\\"path\\\":\\\"x.ts\\\"}}\"}}]}}"
        )
        .expect("write started");
        writeln!(
            file,
            "{{\"type\":\"tool_result\",\"tool_call_id\":\"new_1\",\"content\":\"ok\"}}"
        )
        .expect("write completed");
    }

    let next = poll_chat_history_tool_signals(&path, &mut state).expect("incremental");
    assert_eq!(next.len(), 2);
    assert!(matches!(
        &next[0],
        GrokHistoryToolSignal::Started {
            tool_id,
            tool_name,
            ..
        } if tool_id == "new_1" && tool_name == "write_file"
    ));
    assert!(matches!(
        &next[1],
        GrokHistoryToolSignal::Completed { tool_id, .. } if tool_id == "new_1"
    ));

    let again = poll_chat_history_tool_signals(&path, &mut state).expect("idle");
    assert!(again.is_empty());

    // New session path: file missing first, then appears with tools — must not EOF-skip.
    let path_new = dir.join("chat_history_new.jsonl");
    let mut new_state = GrokToolHistoryTailState::for_turn(false);
    let missing = poll_chat_history_tool_signals(&path_new, &mut new_state).expect("missing");
    assert!(missing.is_empty());
    assert!(new_state.saw_missing);
    assert!(!new_state.baseline_set);
    std::fs::write(
        &path_new,
        "{\"type\":\"assistant\",\"content\":\"\",\"tool_calls\":[{\"id\":\"born_1\",\"name\":\"read_file\",\"arguments\":\"{}\"}]}\n",
    )
    .expect("create with tools");
    let born = poll_chat_history_tool_signals(&path_new, &mut new_state).expect("born");
    assert_eq!(born.len(), 1);
    assert!(matches!(
        &born[0],
        GrokHistoryToolSignal::Started { tool_id, .. } if tool_id == "born_1"
    ));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn flat_tool_call_prefers_top_level_name_over_missing_function() {
    let chat_history = concat!(
        "{\"type\":\"assistant\",\"content\":\"\",\"tool_calls\":[{\"id\":\"call-x\",\"arguments\":\"{}\"}]}\n"
    );
    let result = parse_messages_from_chat_history(chat_history);
    assert_eq!(result.messages.len(), 1);
    assert_eq!(result.messages[0].tool_type.as_deref(), Some("tool"));
    assert_eq!(result.messages[0].title.as_deref(), Some("tool"));
}

#[test]
fn skips_system_synthetic_and_unknown_lines() {
    let chat_history = concat!(
        "{\"type\":\"system\",\"content\":\"sys\"}\n",
        "{\"type\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"nope\"}],\"synthetic_reason\":\"reminder\"}\n",
        "{\"type\":\"max_turns_reached\"}\n",
        "{\"type\":\"auto_compact_started\"}\n",
        "not json at all\n",
        "{\"type\":\"reasoning\",\"summary\":[\"part one\",{\"text\":\"part two\"}]}\n"
    );

    let result = parse_messages_from_chat_history(chat_history);

    assert_eq!(result.messages.len(), 1);
    assert_eq!(result.messages[0].kind, "reasoning");
    assert_eq!(result.messages[0].text, "part one\npart two");
}

#[test]
fn skips_user_info_git_status_envelopes_without_synthetic_reason() {
    let chat_history = concat!(
        r#"{"type":"user","content":[{"type":"text","text":"<user_info>\nOS Version: macos\nShell: /bin/zsh\nWorkspace Path: /tmp/repo\nToday's date: 2026-07-31\n</user_info>"}]}"#,
        "\n",
        r#"{"type":"user","content":[{"type":"text","text":"<user_info>\nOS Version: macos\n</user_info>\n\n<git_status>\n## main\n M src/a.ts\n</git_status>"}]}"#,
        "\n",
        r#"{"type":"user","content":[{"type":"text","text":"<system-reminder>\nAs you answer...\n</system-reminder>"}],"synthetic_reason":"project_instructions"}"#,
        "\n",
        r#"{"type":"user","content":[{"type":"text","text":"<user_query>\n你好\n</user_query>"}],"prompt_index":0}"#,
        "\n",
        r#"{"type":"assistant","content":"你好。我是 Grok。","model_id":"grok-build"}"#,
        "\n",
    );

    let result = parse_messages_from_chat_history(chat_history);
    assert_eq!(result.messages.len(), 2);
    assert_eq!(result.messages[0].role, "user");
    assert_eq!(result.messages[0].text, "你好");
    assert_eq!(result.messages[1].role, "assistant");
    assert_eq!(result.messages[1].text, "你好。我是 Grok。");
}

#[test]
fn skips_user_info_plus_rules_bootstrap_without_synthetic_reason() {
    // Real Grok CLI shape: first non-synthetic user line is user_info + a
    // large rules pack (AGENTS.md etc.). Residual <rules> used to leak into
    // first_message as "<user_info> OS Version: macos Shell...".
    let bootstrap = concat!(
        "<user_info>\n",
        "OS Version: macos\n",
        "Shell: /bin/zsh\n",
        "Workspace Path: /Users/me/fx-data-web\n",
        "</user_info>\n",
        "\n",
        "<rules>\n",
        "# Development Guidelines\n",
        "## Overview\n",
        "AGENTS.md and nested workspace rules...\n",
        "</rules>",
    );
    let chat_history = format!(
        "{}\n{}\n{}\n",
        serde_json::json!({
            "type": "user",
            "content": [{"type": "text", "text": bootstrap}],
        }),
        r#"{"type":"user","content":[{"type":"text","text":"<user_query>\n阅读下本地未提交代码\n</user_query>"}],"prompt_index":0}"#,
        r#"{"type":"assistant","content":"好的。","model_id":"grok-build"}"#,
    );

    assert!(is_grok_runtime_context_user_text(bootstrap));
    assert_eq!(
        first_user_prompt_text(&chat_history).as_deref(),
        Some("阅读下本地未提交代码")
    );

    let result = parse_messages_from_chat_history(&chat_history);
    assert_eq!(result.messages.len(), 2);
    assert_eq!(result.messages[0].role, "user");
    assert_eq!(result.messages[0].text, "阅读下本地未提交代码");
    assert_eq!(result.messages[1].role, "assistant");
}

#[test]
fn first_user_prompt_skips_runtime_context_and_returns_real_query() {
    let chat_history = concat!(
        r#"{"type":"user","content":[{"type":"text","text":"<user_info>\nOS Version: macos\n</user_info>"}]}"#,
        "\n",
        r#"{"type":"user","content":[{"type":"text","text":"<user_query>\n你好\n</user_query>"}],"prompt_index":0}"#,
        "\n",
    );
    assert_eq!(
        first_user_prompt_text(chat_history).as_deref(),
        Some("你好")
    );
    assert!(is_grok_runtime_context_user_text(
        "<user_info>\nOS Version: macos\n</user_info>"
    ));
    assert!(is_grok_runtime_context_user_text(
        "<rules>\n# Development Guidelines\n</rules>"
    ));
    assert!(!is_grok_runtime_context_user_text(
        "<user_query>\n你好\n</user_query>"
    ));
    assert!(!is_grok_runtime_context_user_text("plain hello"));
}

#[test]
fn strips_user_query_wrapper() {
    assert_eq!(
        strip_user_query_wrapper("<user_query>\nhello world\n</user_query>"),
        "hello world"
    );
    assert_eq!(strip_user_query_wrapper("plain text"), "plain text");
    assert_eq!(strip_user_query_wrapper("  padded  "), "padded");
}

#[test]
fn parses_multimodal_image_files_and_user_query() {
    let raw = concat!(
        "<image_files>\n",
        "The following images were provided by the user and saved to the workspace for future use:\n",
        "1. /Users/me/.grok/sessions/%2Fcode%2Fcontent/abc/assets/image-1.png\n",
        "\n",
        "These images can be copied for use in other locations.\n",
        "</image_files>\n",
        "\n",
        "<user_query>\n",
        "你看这是啥\n",
        "</user_query>",
    );
    let (display, images) = parse_grok_user_prompt_for_display(raw);
    assert_eq!(display, "你看这是啥");
    assert_eq!(
        images,
        vec!["/Users/me/.grok/sessions/%2Fcode%2Fcontent/abc/assets/image-1.png".to_string()]
    );
}

#[test]
fn strips_image_only_cli_fallback_text_from_display() {
    use super::super::cli_image_input::GROK_IMAGE_ONLY_FALLBACK_TEXT;
    let raw = concat!(
        "<image_files>\n",
        "The following images were provided by the user and saved to the workspace for future use:\n",
        "1. /Users/me/.grok/sessions/abc/assets/image-only.png\n",
        "\n",
        "These images can be copied for use in other locations.\n",
        "</image_files>\n",
        "\n",
        "<user_query>\n",
        "Please analyze the attached image(s).\n",
        "</user_query>",
    );
    let (display, images) = parse_grok_user_prompt_for_display(raw);
    assert_eq!(display, "", "CLI fallback must not appear as user text");
    assert_eq!(
        images,
        vec!["/Users/me/.grok/sessions/abc/assets/image-only.png".to_string()]
    );
    // Exact fallback alone (no image_files wrapper) also strips.
    let (display_plain, images_plain) =
        parse_grok_user_prompt_for_display(GROK_IMAGE_ONLY_FALLBACK_TEXT);
    assert_eq!(display_plain, "");
    assert!(images_plain.is_empty());
}

#[test]
fn keeps_user_text_that_mentions_analyze_with_real_content() {
    let raw = concat!(
        "<image_files>\n",
        "1. /tmp/assets/image-a.png\n",
        "</image_files>\n",
        "\n",
        "<user_query>\n",
        "Please analyze the attached image(s). Focus on the red box.\n",
        "</user_query>",
    );
    let (display, images) = parse_grok_user_prompt_for_display(raw);
    assert_eq!(
        display,
        "Please analyze the attached image(s). Focus on the red box."
    );
    assert_eq!(images, vec!["/tmp/assets/image-a.png".to_string()]);
}

#[test]
fn history_loader_strips_image_only_fallback_text() {
    let chat_history = concat!(
        r#"{"type":"user","content":[{"type":"text","text":"<image_files>\nThe following images were provided by the user and saved to the workspace for future use:\n1. /tmp/assets/image-only.png\n\nThese images can be copied for use in other locations.\n</image_files>\n\n<user_query>\nPlease analyze the attached image(s).\n</user_query>"}],"prompt_index":0}"#,
        "\n",
    );
    let result = parse_messages_from_chat_history(chat_history);
    assert_eq!(result.messages.len(), 1);
    assert_eq!(result.messages[0].role, "user");
    assert_eq!(result.messages[0].text, "");
    assert_eq!(
        result.messages[0].images.as_deref(),
        Some(&["/tmp/assets/image-only.png".to_string()][..])
    );
}

#[test]
fn history_loader_extracts_images_from_image_files_block() {
    let chat_history = concat!(
        r#"{"type":"user","content":[{"type":"text","text":"<image_files>\nThe following images were provided by the user and saved to the workspace for future use:\n1. /tmp/assets/image-abc.png\n\nThese images can be copied for use in other locations.\n</image_files>\n\n<user_query>\n看图\n</user_query>"}],"prompt_index":0}"#,
        "\n",
    );
    let result = parse_messages_from_chat_history(chat_history);
    assert_eq!(result.messages.len(), 1);
    assert_eq!(result.messages[0].role, "user");
    assert_eq!(result.messages[0].text, "看图");
    assert_eq!(
        result.messages[0].images.as_deref(),
        Some(&["/tmp/assets/image-abc.png".to_string()][..])
    );
}

#[test]
fn decodes_url_encoded_cwd_dir_names() {
    assert_eq!(url_decode_dir_name("%2Fprivate%2Ftmp"), "/private/tmp");
    assert_eq!(
        url_decode_dir_name("%2FUsers%2Fdemo%2Fmy%20repo"),
        "/Users/demo/my repo"
    );
    assert_eq!(url_decode_dir_name("plain"), "plain");
}

#[test]
fn matches_workspace_path_variants() {
    let variants = vec![
        "/Users/demo/repo".to_string(),
        "/private/Users/demo/repo".to_string(),
    ];
    assert!(matches_workspace_path("/Users/demo/repo", &variants));
    assert!(matches_workspace_path(
        "/private/Users/demo/repo",
        &variants
    ));
    assert!(matches_workspace_path(
        "/Users/demo/repo/packages/app",
        &variants
    ));
    assert!(!matches_workspace_path("/Users/demo/other", &variants));
    assert!(!matches_workspace_path("", &variants));
    // Home-level sessions must not appear inside nested empty folders.
    assert!(!matches_workspace_path(
        "/Users/demo",
        &["/Users/demo/Desktop/新的空文件夹".to_string()]
    ));
}

#[test]
fn parses_rfc3339_timestamps() {
    assert_eq!(
        parse_timestamp_millis("2026-07-27T06:31:41.023Z"),
        Some(1785133901023)
    );
    assert_eq!(parse_timestamp_millis("not-a-date"), None);
}

#[test]
fn session_activity_prefers_chat_mtime_over_bulk_summary_updated_at() {
    // Grok CLI bulk-rewrote summary.updated_at for many idle sessions at the
    // same instant. Chat history mtime still reflects real last activity.
    let chat_mtime = 1_785_400_000_000;
    let bulk_summary_updated_at = 1_785_488_000_000;
    let summary_mtime = bulk_summary_updated_at;
    let created_at = 1_785_300_000_000;
    assert_eq!(
        resolve_session_activity_millis(
            Some(chat_mtime),
            Some(bulk_summary_updated_at),
            Some(summary_mtime),
            created_at,
        ),
        chat_mtime,
    );
}

#[test]
fn session_activity_falls_back_to_summary_when_chat_missing() {
    let summary_updated_at = 1_785_400_000_000;
    let summary_mtime = 1_785_400_000_100;
    let created_at = 1_785_300_000_000;
    assert_eq!(
        resolve_session_activity_millis(
            None,
            Some(summary_updated_at),
            Some(summary_mtime),
            created_at,
        ),
        summary_updated_at,
    );
    assert_eq!(
        resolve_session_activity_millis(None, None, Some(summary_mtime), created_at),
        summary_mtime,
    );
    assert_eq!(
        resolve_session_activity_millis(None, None, None, created_at),
        created_at,
    );
}

#[test]
fn workspace_match_requires_variants() {
    assert!(!matches_workspace_path("/tmp", &[]));
    let _ = Path::new("/tmp");
}

#[tokio::test]
async fn lists_loads_and_deletes_sessions_from_fixture_dirs() {
    let fixture_root = std::env::temp_dir().join(format!(
        "ccgui-grok-history-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let workspace = fixture_root.join("workspace");
    let grok_home = fixture_root.join("grok-home");
    std::fs::create_dir_all(&workspace).expect("create workspace");
    let canonical_workspace = std::fs::canonicalize(&workspace).expect("canonical workspace");
    let encoded_cwd = {
        let raw = canonical_workspace.to_string_lossy().to_string();
        raw.chars()
            .map(|ch| match ch {
                'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => ch.to_string(),
                _ => format!("%{:02X}", ch as u32),
            })
            .collect::<String>()
    };
    let session_dir = grok_home
        .join("sessions")
        .join(&encoded_cwd)
        .join("019fa245-0000-4000-8000-000000000001");
    std::fs::create_dir_all(&session_dir).expect("create session dir");
    std::fs::write(
        session_dir.join("summary.json"),
        "{\"info\":{\"id\":\"019fa245-0000-4000-8000-000000000001\",\"cwd\":\"/tmp\"},\"session_summary\":\"Fixture title\",\"created_at\":\"2026-07-27T06:31:41.023Z\",\"updated_at\":\"2026-07-27T07:31:41.023Z\",\"num_messages\":3,\"num_chat_messages\":2}",
    )
    .expect("write summary");
    std::fs::write(
        session_dir.join("chat_history.jsonl"),
        concat!(
            "{\"type\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"<user_query>\\nhello\\n</user_query>\"}],\"prompt_index\":0}\n",
            "{\"type\":\"assistant\",\"content\":\"hi\",\"model_id\":\"grok-build\"}\n"
        ),
    )
    .expect("write chat history");

    let listed =
        super::list_grok_sessions(&workspace, None, Some(grok_home.to_string_lossy().as_ref()))
            .await
            .expect("list sessions");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].session_id, "019fa245-0000-4000-8000-000000000001");
    // Prefer first real user prompt over Grok generated_title / session_summary.
    assert_eq!(listed[0].first_message, "hello");
    assert_eq!(listed[0].message_count, 2);
    assert_eq!(listed[0].engine.as_deref(), Some("grok"));
    // Activity time follows chat_history mtime, not a stale/bulk summary stamp.
    let chat_mtime =
        file_mtime_millis(&session_dir.join("chat_history.jsonl")).expect("chat history mtime");
    assert_eq!(listed[0].updated_at, chat_mtime);

    let loaded = super::load_grok_session(
        &workspace,
        "019fa245-0000-4000-8000-000000000001",
        Some(grok_home.to_string_lossy().as_ref()),
    )
    .await
    .expect("load session");
    assert_eq!(loaded.messages.len(), 2);
    assert_eq!(loaded.messages[0].text, "hello");
    assert_eq!(loaded.messages[1].text, "hi");

    super::delete_grok_session(
        &workspace,
        "019fa245-0000-4000-8000-000000000001",
        Some(grok_home.to_string_lossy().as_ref()),
    )
    .await
    .expect("delete session");
    assert!(!session_dir.exists());
    let remaining =
        super::list_grok_sessions(&workspace, None, Some(grok_home.to_string_lossy().as_ref()))
            .await
            .expect("list after delete");
    assert!(remaining.is_empty());

    let _ = std::fs::remove_dir_all(&fixture_root);
}

#[test]
fn url_encode_dir_name_percent_encodes_utf8_bytes() {
    assert_eq!(url_encode_dir_name("/private/tmp"), "%2Fprivate%2Ftmp");
    assert_eq!(
        url_encode_dir_name("/Users/demo/my repo"),
        "%2FUsers%2Fdemo%2Fmy%20repo"
    );
    // Chinese "项目" → UTF-8 E9 A1 B9 E7 9B AE
    assert_eq!(
        url_encode_dir_name("/tmp/项目"),
        "%2Ftmp%2F%E9%A1%B9%E7%9B%AE"
    );
    assert_eq!(
        url_decode_dir_name(&url_encode_dir_name("/Users/demo/CC GUI 项目")),
        "/Users/demo/CC GUI 项目"
    );
}

#[test]
fn first_user_prompt_from_line_extracts_query_without_parsing_huge_payload() {
    let huge_b64 = "A".repeat(200_000);
    let line = format!(
        r#"{{"type":"user","content":[{{"type":"text","text":"<image_files>\n1. /tmp/a.png\n</image_files>\n\n<user_query>\nanalyze chart\n</user_query>\n{}"}}],"prompt_index":0}}"#,
        format!("data:image/png;base64,{}", huge_b64)
    );
    assert!(line.len() > 100_000);
    assert_eq!(
        first_user_prompt_from_line(&line).as_deref(),
        Some("analyze chart")
    );
}

#[test]
fn load_parser_strips_tool_result_images_and_budgets_output() {
    let huge = "x".repeat(GROK_TOOL_OUTPUT_CHAR_BUDGET + 8_000);
    let chat_history = format!(
        concat!(
            r#"{{"type":"tool_result","tool_call_id":"call_img","content":"{}","images":[{{"type":"image","url":"data:image/jpeg;base64,{}"}}]}}"#,
            "\n",
            r#"{{"type":"reasoning","id":"r-big","summary":"ok","encrypted_content":"{}"}}"#,
            "\n"
        ),
        huge,
        "B".repeat(120_000),
        "C".repeat(80_000)
    );
    let result = parse_messages_from_chat_history(&chat_history);
    assert_eq!(result.messages.len(), 2);
    let tool = &result.messages[0];
    assert_eq!(tool.kind, "tool");
    assert!(tool.text.chars().count() <= GROK_TOOL_OUTPUT_CHAR_BUDGET + 80);
    assert!(tool.text.contains("truncated"));
    assert!(
        tool.tool_output
            .as_ref()
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.contains("data:image")),
        "tool_output must not carry raw images"
    );
    let reasoning = &result.messages[1];
    assert_eq!(reasoning.kind, "reasoning");
    assert_eq!(reasoning.text, "ok");
    // Encrypted blob must not appear in normalized messages.
    assert!(!reasoning.text.contains(&"C".repeat(100)));
}

#[test]
fn prepare_line_redacts_encrypted_content_and_blanks_images() {
    let line = format!(
        r#"{{"type":"tool_result","tool_call_id":"c1","content":"hi","images":[{{"type":"image","url":"{}"}}],"encrypted_content":"{}"}}"#,
        "Z".repeat(40_000),
        "E".repeat(40_000)
    );
    let prepared = prepare_grok_history_line_for_parse(&line);
    assert!(prepared.contains("\"images\":[]"));
    assert!(prepared.contains(GROK_OMITTED_PAYLOAD_SENTINEL));
    assert!(!prepared.contains(&"Z".repeat(1000)));
    assert!(!prepared.contains(&"E".repeat(1000)));
}

#[tokio::test]
async fn load_session_uses_direct_path_without_full_tree_scan_dependency() {
    let fixture_root = std::env::temp_dir().join(format!(
        "grok-history-o1-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let workspace = fixture_root.join("workspace");
    let grok_home = fixture_root.join("grok-home");
    std::fs::create_dir_all(&workspace).expect("create workspace");
    let canonical_workspace = std::fs::canonicalize(&workspace).expect("canonical workspace");
    let encoded_cwd = url_encode_dir_name(&canonical_workspace.to_string_lossy());
    let session_id = "019fa245-0000-4000-8000-000000000099";
    let session_dir = grok_home
        .join("sessions")
        .join(&encoded_cwd)
        .join(session_id);
    std::fs::create_dir_all(&session_dir).expect("create session dir");
    // Decoy cwd with huge irrelevant session — direct path must still win.
    let decoy = grok_home
        .join("sessions")
        .join(url_encode_dir_name("/unrelated/path"))
        .join("decoy-session");
    std::fs::create_dir_all(&decoy).expect("decoy");
    std::fs::write(
        decoy.join("chat_history.jsonl"),
        format!(
            "{{\"type\":\"user\",\"content\":\"{}\"}}\n",
            "y".repeat(50_000)
        ),
    )
    .expect("decoy history");
    std::fs::write(
        session_dir.join("summary.json"),
        format!(
            "{{\"info\":{{\"id\":\"{}\",\"cwd\":\"{}\"}},\"num_chat_messages\":1,\"created_at\":\"2026-07-27T06:31:41.023Z\",\"updated_at\":\"2026-07-27T07:31:41.023Z\"}}",
            session_id,
            canonical_workspace.display()
        ),
    )
    .expect("summary");
    std::fs::write(
        session_dir.join("chat_history.jsonl"),
        concat!(
            "{\"type\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"<user_query>\\ndirect path\\n</user_query>\"}],\"prompt_index\":0}\n",
            "{\"type\":\"assistant\",\"content\":\"ok\"}\n"
        ),
    )
    .expect("history");

    let loaded = super::load_grok_session(
        &workspace,
        session_id,
        Some(grok_home.to_string_lossy().as_ref()),
    )
    .await
    .expect("load");
    assert_eq!(loaded.messages.len(), 2);
    assert_eq!(loaded.messages[0].text, "direct path");

    let listed =
        super::list_grok_sessions(&workspace, None, Some(grok_home.to_string_lossy().as_ref()))
            .await
            .expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].first_message, "direct path");

    let _ = std::fs::remove_dir_all(&fixture_root);
}
