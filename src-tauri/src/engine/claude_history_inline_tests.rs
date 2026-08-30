use super::{
    encode_project_path, is_encoded_workspace_prefix_match,
    list_claude_session_source_facts_from_base_dir, list_claude_sessions_from_base_dir,
    load_claude_session_from_base_dir, scan_session_source_file, ClaudeSessionAttributionScope,
    ClaudeSessionScanDiagnosticCode, CLAUDE_ATTRIBUTION_REASON_GIT_ROOT,
    CLAUDE_ATTRIBUTION_REASON_PROJECT_DIRECTORY, CLAUDE_ATTRIBUTION_REASON_TRANSCRIPT_CWD,
    CLAUDE_ATTRIBUTION_STRICT_MATCH,
};
use crate::engine::claude_history_entries::{
    classify_claude_history_entry, extract_command_prompt_text, is_claude_control_plane_entry,
    ClaudeHistoryEntryClassification, ClaudeHistoryHiddenReason, ClaudeLocalControlEventType,
    CLAUDE_CONTROL_EVENT_TOOL_TYPE,
};
use crate::engine::EngineConfig;
use serde_json::json;
use uuid::Uuid;

fn create_project_dir(
    base_dir: &std::path::Path,
    workspace_path: &std::path::Path,
) -> std::path::PathBuf {
    let project_dir = base_dir.join(encode_project_path(&workspace_path.to_string_lossy()));
    std::fs::create_dir_all(&project_dir).expect("create project dir");
    project_dir
}

fn write_jsonl_lines(path: &std::path::Path, lines: &[serde_json::Value], line_ending: &str) {
    let payload = lines
        .iter()
        .map(|line| line.to_string())
        .collect::<Vec<String>>()
        .join(line_ending);
    std::fs::write(path, format!("{}{}", payload, line_ending)).expect("write session");
}

fn synthetic_continuation_summary_text() -> String {
    [
        "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.",
        "",
        "Summary:",
        "Primary Request and Intent:",
        "The user asked to analyze the current project.",
        "",
        "Current Work:",
        "Continue the conversation from where it left off without asking the user any further questions.",
    ]
    .join("\n")
}

#[tokio::test]
async fn scan_session_source_file_marks_read_error_as_partial() {
    use std::io::Write as _;

    let unique = Uuid::new_v4();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-read-error-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_path = project_dir.join(format!("read-error-{}.jsonl", unique));
    let valid_line = json!({
        "sessionId": format!("read-error-{}", unique),
        "timestamp": "2026-01-01T00:00:00Z",
        "cwd": workspace_path.to_string_lossy(),
        "message": { "role": "user", "content": "Visible before invalid bytes" }
    })
    .to_string();
    let mut file = std::fs::File::create(&session_path).expect("create invalid utf8 fixture");
    file.write_all(valid_line.as_bytes())
        .expect("write valid line");
    file.write_all(b"\n\xff\xfe\n")
        .expect("write invalid utf8 bytes");

    let outcome = scan_session_source_file(
        &session_path,
        &[ClaudeSessionAttributionScope::workspace_path(
            workspace_path,
        )],
        true,
    )
    .await;

    let fact = outcome.fact.expect("partial source fact");
    assert_eq!(fact.source_health, "partial");
    assert!(outcome
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == ClaudeSessionScanDiagnosticCode::UnreadableFile));

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[test]
fn encoded_workspace_prefix_match_supports_nested_project_dirs() {
    assert!(is_encoded_workspace_prefix_match(
        "-Users-chenxiangning-code-AI-github-codeg-mossx",
        "-Users-chenxiangning-code-AI-github-codeg"
    ));
    assert!(!is_encoded_workspace_prefix_match(
        "-Users-chenxiangning-code-AI-github-codegen",
        "-Users-chenxiangning-code-AI-github-codeg"
    ));
}

#[test]
fn encoded_workspace_prefix_match_rejects_pure_hyphen_non_ascii_collisions() {
    // Same-length Chinese Desktop siblings encode to identical pure-hyphen tails.
    // Longer Chinese names must not look like nested children of shorter ones.
    let empty_folder = encode_project_path("/Users/zhukunpeng/Desktop/新的空文件夹");
    let personal_finance = encode_project_path("/Users/zhukunpeng/Desktop/个人财务管理");
    let longer_chinese = encode_project_path("/Users/zhukunpeng/Desktop/个人财务管理系统测试");
    assert_eq!(empty_folder, personal_finance);
    assert!(empty_folder.ends_with("-------"));
    assert!(is_encoded_workspace_prefix_match(
        empty_folder.as_str(),
        empty_folder.as_str()
    ));
    assert!(!is_encoded_workspace_prefix_match(
        longer_chinese.as_str(),
        empty_folder.as_str()
    ));
    // ASCII nested project dirs still match.
    assert!(is_encoded_workspace_prefix_match(
        "-Users-demo-Desktop-repo-packages-app",
        "-Users-demo-Desktop-repo"
    ));
}

#[tokio::test]
async fn list_claude_sessions_rejects_non_ascii_project_dir_collision() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-cjk-collision-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let empty_folder = temp_root.join("新的空文件夹");
    let personal_finance = temp_root.join("个人财务管理");
    std::fs::create_dir_all(&empty_folder).expect("create empty folder workspace");
    std::fs::create_dir_all(&personal_finance).expect("create personal finance workspace");
    std::fs::create_dir_all(&base_dir).expect("create claude projects base");

    // Same encoded bucket for both Chinese workspaces.
    assert_eq!(
        encode_project_path(&empty_folder.to_string_lossy()),
        encode_project_path(&personal_finance.to_string_lossy())
    );
    let shared_project_dir = create_project_dir(&base_dir, &personal_finance);

    let foreign_session_id = format!("foreign-cjk-{}", unique);
    write_jsonl_lines(
        &shared_project_dir.join(format!("{}.jsonl", foreign_session_id)),
        &[json!({
            "uuid": "user-1",
            "timestamp": "2026-05-09T08:00:00.000Z",
            "session_id": foreign_session_id,
            "cwd": personal_finance.to_string_lossy(),
            "message": { "role": "user", "content": "Nihao" }
        })],
        "\n",
    );
    let own_session_id = format!("own-cjk-{}", unique);
    write_jsonl_lines(
        &shared_project_dir.join(format!("{}.jsonl", own_session_id)),
        &[json!({
            "uuid": "user-2",
            "timestamp": "2026-05-09T09:00:00.000Z",
            "session_id": own_session_id,
            "cwd": empty_folder.to_string_lossy(),
            "message": { "role": "user", "content": "only mine" }
        })],
        "\n",
    );

    let empty_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        empty_folder.clone(),
    )];
    let empty_listed =
        list_claude_sessions_from_base_dir(&base_dir, &empty_folder, &empty_scopes, None)
            .await
            .expect("list for empty chinese folder");
    assert!(
        empty_listed
            .iter()
            .all(|session| session.session_id != foreign_session_id),
        "foreign cwd session must not leak into colliding chinese workspace"
    );
    assert!(
        empty_listed
            .iter()
            .any(|session| session.session_id == own_session_id),
        "own cwd session in shared bucket must still appear"
    );

    let finance_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        personal_finance.clone(),
    )];
    let finance_listed =
        list_claude_sessions_from_base_dir(&base_dir, &personal_finance, &finance_scopes, None)
            .await
            .expect("list for personal finance workspace");
    assert!(finance_listed
        .iter()
        .any(|session| session.session_id == foreign_session_id));
    assert!(finance_listed
        .iter()
        .all(|session| session.session_id != own_session_id));

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn list_claude_sessions_keeps_missing_cwd_project_dir_fallback() {
    let unique = Uuid::new_v4().to_string();
    let temp_root =
        std::env::temp_dir().join(format!("ccgui-claude-missing-cwd-fallback-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_id = format!("missing-cwd-keep-{}", unique);
    write_jsonl_lines(
        &project_dir.join(format!("{}.jsonl", session_id)),
        &[json!({
            "uuid": "user-1",
            "timestamp": "2026-05-09T08:00:00.000Z",
            "session_id": session_id,
            "message": { "role": "user", "content": "legacy transcript without cwd" }
        })],
        "\n",
    );

    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];
    let sessions =
        list_claude_sessions_from_base_dir(&base_dir, &workspace_path, &attribution_scopes, None)
            .await
            .expect("list sessions");
    let session = sessions
        .iter()
        .find(|entry| entry.session_id == session_id)
        .expect("missing-cwd fallback session");
    assert_eq!(
        session.attribution_reason.as_deref(),
        Some(CLAUDE_ATTRIBUTION_REASON_PROJECT_DIRECTORY)
    );

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn list_claude_sessions_with_config_reads_configured_home_projects_dir() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-config-home-{}", unique));
    let claude_home = temp_root.join("custom-claude-home");
    let base_dir = claude_home.join("projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_id = format!("configured-home-session-{}", unique);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));
    write_jsonl_lines(
        &session_path,
        &[
            json!({
                "uuid": "user-1",
                "timestamp": "2026-05-09T08:00:00.000Z",
                "session_id": session_id,
                "cwd": workspace_path.to_string_lossy(),
                "message": { "role": "user", "content": "Use configured Claude home" }
            }),
            json!({
                "uuid": "assistant-1",
                "timestamp": "2026-05-09T08:00:01.000Z",
                "session_id": session_id,
                "message": { "role": "assistant", "content": "Configured home detected." }
            }),
        ],
        "\n",
    );
    let config = EngineConfig {
        home_dir: Some(claude_home.to_string_lossy().to_string()),
        ..EngineConfig::default()
    };

    let sessions =
        super::list_claude_sessions_with_config(&workspace_path, Some(10), Some(&config))
            .await
            .expect("list sessions from configured home");

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, session_id);
    assert_eq!(sessions[0].first_message, "Use configured Claude home");

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn scan_session_source_file_returns_bounded_source_fact() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-source-fact-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_id = format!("source-fact-{}", unique);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));
    let long_prompt =
        "请帮我分析工作区会话 Claude Code 为什么会被吞掉，并给出稳定重构边界、测试矩阵、source completeness 语义和后续缓存演进策略";
    write_jsonl_lines(
        &session_path,
        &[
            json!({
                "uuid": "user-1",
                "timestamp": "2026-05-09T08:00:00.000Z",
                "cwd": workspace_path.to_string_lossy(),
                "message": { "role": "user", "content": long_prompt }
            }),
            json!({
                "uuid": "assistant-1",
                "timestamp": "2026-05-09T08:00:02.000Z",
                "session_id": session_id,
                "message": { "role": "assistant", "content": "Use catalog projection." }
            }),
        ],
        "\n",
    );

    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];
    let outcome = scan_session_source_file(&session_path, &attribution_scopes, true).await;
    let fact = outcome.fact.expect("valid source fact");

    assert!(outcome.diagnostics.is_empty());
    assert_eq!(fact.canonical_session_id, session_id);
    assert_eq!(fact.display_session_id, fact.canonical_session_id);
    assert_eq!(
        fact.physical_path,
        session_path.to_string_lossy().to_string()
    );
    assert_eq!(
        fact.claude_project_dir.as_deref(),
        Some(project_dir.to_string_lossy().as_ref())
    );
    assert_eq!(
        fact.cwd.as_deref(),
        Some(workspace_path.to_string_lossy().as_ref())
    );
    assert_eq!(fact.message_count, 2);
    assert_eq!(fact.source_health, "complete");
    assert!(fact
        .first_real_user_message
        .as_deref()
        .unwrap_or_default()
        .ends_with('…'));

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn scan_session_source_file_prefers_latest_valid_native_custom_title() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-native-title-{unique}"));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_path = project_dir.join(format!("native-title-{unique}.jsonl"));
    write_jsonl_lines(
        &session_path,
        &[
            json!({
                "uuid": "user-1",
                "timestamp": "2026-05-09T08:00:00.000Z",
                "cwd": workspace_path.to_string_lossy(),
                "message": { "role": "user", "content": "First prompt fallback" }
            }),
            json!({
                "type": "custom-title",
                "customTitle": "Earlier native title"
            }),
            json!({
                "type": "custom-title",
                "customTitle": "   "
            }),
            json!({
                "type": "custom-title",
                "customTitle": "Latest native title"
            }),
            json!({
                "uuid": "assistant-1",
                "timestamp": "2026-05-09T08:00:02.000Z",
                "message": { "role": "assistant", "content": "Answer" }
            }),
        ],
        "\n",
    );

    let outcome = scan_session_source_file(
        &session_path,
        &[ClaudeSessionAttributionScope::workspace_path(
            workspace_path,
        )],
        true,
    )
    .await;
    let fact = outcome.fact.expect("valid source fact");

    assert_eq!(
        fact.first_real_user_message.as_deref(),
        Some("First prompt fallback")
    );
    assert_eq!(fact.native_title.as_deref(), Some("Latest native title"));
    assert_eq!(fact.message_count, 2);
    let summary = fact.to_summary();
    assert_eq!(summary.first_message, "First prompt fallback");
    assert_eq!(summary.native_title.as_deref(), Some("Latest native title"));

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn scan_session_source_file_reports_unresolved_candidates() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-source-diagnostic-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    let sibling_path = temp_root.join("sibling");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    std::fs::create_dir_all(&sibling_path).expect("create sibling path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];

    let mismatched_path = project_dir.join(format!("cwd-mismatch-{}.jsonl", unique));
    write_jsonl_lines(
        &mismatched_path,
        &[json!({
            "uuid": "user-1",
            "timestamp": "2026-05-09T08:00:00.000Z",
            "cwd": sibling_path.to_string_lossy(),
            "message": { "role": "user", "content": "This belongs elsewhere" }
        })],
        "\n",
    );
    // Explicit foreign cwd must never be claimed via project-directory fallback.
    // Shared Claude project buckets (non-ASCII path collisions) would otherwise
    // leak sibling-workspace history into empty/new folders.
    let mismatched = scan_session_source_file(&mismatched_path, &attribution_scopes, true).await;
    assert!(mismatched.fact.is_none());
    assert!(mismatched.diagnostics.iter().any(|diagnostic| {
        diagnostic.code == ClaudeSessionScanDiagnosticCode::CwdOutsideAttributionScope
    }));

    let missing_cwd_path = project_dir.join(format!("missing-cwd-{}.jsonl", unique));
    write_jsonl_lines(
        &missing_cwd_path,
        &[json!({
            "uuid": "user-1",
            "timestamp": "2026-05-09T08:00:00.000Z",
            "message": { "role": "user", "content": "No cwd evidence" }
        })],
        "\n",
    );
    let missing_cwd = scan_session_source_file(&missing_cwd_path, &attribution_scopes, false).await;
    assert!(missing_cwd.fact.is_none());
    assert!(missing_cwd.diagnostics.iter().any(|diagnostic| {
        diagnostic.code == ClaudeSessionScanDiagnosticCode::MissingCwdWithoutFallback
    }));

    let malformed_path = project_dir.join(format!("malformed-{}.jsonl", unique));
    std::fs::write(&malformed_path, "{not-json}\n").expect("write malformed transcript");
    let malformed = scan_session_source_file(&malformed_path, &attribution_scopes, true).await;
    assert!(malformed.fact.is_none());
    assert!(malformed.diagnostics.iter().any(|diagnostic| {
        diagnostic.code == ClaudeSessionScanDiagnosticCode::MalformedTranscript
    }));

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn scan_session_source_file_does_not_inline_large_payloads() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-large-source-fact-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_id = format!("large-source-fact-{}", unique);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));
    let inline_payload = "a".repeat(700 * 1024);
    write_jsonl_lines(
        &session_path,
        &[json!({
            "uuid": "user-1",
            "timestamp": "2026-05-09T08:00:00.000Z",
            "cwd": workspace_path.to_string_lossy(),
            "message": {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": inline_payload.clone()
                        }
                    },
                    { "type": "text", "text": "Inspect the screenshot" }
                ]
            }
        })],
        "\n",
    );

    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];
    let outcome = scan_session_source_file(&session_path, &attribution_scopes, true).await;
    let fact = outcome.fact.expect("large payload source fact");
    let serialized_fact = serde_json::to_string(&fact).expect("serialize fact");

    assert_eq!(
        fact.first_real_user_message.as_deref(),
        Some("Inspect the screenshot")
    );
    assert!(!serialized_fact.contains(&inline_payload));
    assert!(!serialized_fact.contains("base64"));

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn scan_session_source_file_skips_control_plane_before_title_evidence() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-control-title-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_id = format!("control-title-{}", unique);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));
    write_jsonl_lines(
        &session_path,
        &[
            json!({
                "method": "initialize",
                "params": {
                    "clientInfo": { "name": "ccgui", "title": "ccgui" }
                }
            }),
            json!({
                "uuid": "user-1",
                "timestamp": "2026-05-09T08:00:00.000Z",
                "cwd": workspace_path.to_string_lossy(),
                "message": {
                    "role": "user",
                    "content": "Real workspace question"
                }
            }),
        ],
        "\n",
    );

    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];
    let outcome = scan_session_source_file(&session_path, &attribution_scopes, true).await;
    let fact = outcome.fact.expect("control-plane filtered fact");

    assert_eq!(
        fact.first_real_user_message.as_deref(),
        Some("Real workspace question")
    );

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn stream_json_stdin_payload_does_not_become_title_or_visible_message() {
    let unique = Uuid::new_v4().to_string();
    let temp_root =
        std::env::temp_dir().join(format!("ccgui-claude-stream-json-pollution-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_id = format!("stream-json-pollution-{}", unique);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));
    let leaked_payload = json!({
        "message": {
            "content": [{ "text": "你好", "type": "text" }],
            "role": "user"
        },
        "type": "user"
    })
    .to_string();
    write_jsonl_lines(
        &session_path,
        &[
            json!({
                "uuid": "polluted-user",
                "timestamp": "2026-06-27T11:00:00.000Z",
                "cwd": workspace_path.to_string_lossy(),
                "message": {
                    "role": "user",
                    "content": leaked_payload
                }
            }),
            json!({
                "uuid": "real-user",
                "timestamp": "2026-06-27T11:01:00.000Z",
                "cwd": workspace_path.to_string_lossy(),
                "message": {
                    "role": "user",
                    "content": "真实问题"
                }
            }),
            json!({
                "uuid": "real-assistant",
                "timestamp": "2026-06-27T11:02:00.000Z",
                "message": {
                    "role": "assistant",
                    "content": "真实回答"
                }
            }),
        ],
        "\n",
    );

    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];
    let outcome = scan_session_source_file(&session_path, &attribution_scopes, true).await;
    let fact = outcome.fact.expect("stream-json pollution filtered fact");
    assert_eq!(fact.first_real_user_message.as_deref(), Some("真实问题"));
    assert_eq!(fact.message_count, 2);

    let loaded = load_claude_session_from_base_dir(&base_dir, &workspace_path, &session_id)
        .await
        .expect("load polluted session");
    assert_eq!(loaded.messages.len(), 2);
    assert!(loaded
        .messages
        .iter()
        .any(|message| message.id == "real-user" && message.text == "真实问题"));
    assert!(loaded
        .messages
        .iter()
        .all(|message| !message.text.contains("\"type\":\"user\"")));

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn stream_json_stdin_payload_quarantines_following_polluted_assistant_echo() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-stream-json-echo-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_id = format!("stream-json-echo-{}", unique);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));
    let leaked_payload = json!({
        "message": {
            "content": [{ "text": "你好", "type": "text" }],
            "role": "user"
        },
        "type": "user"
    })
    .to_string();
    write_jsonl_lines(
        &session_path,
        &[
            json!({
                "uuid": "polluted-user",
                "timestamp": "2026-06-27T11:00:00.000Z",
                "cwd": workspace_path.to_string_lossy(),
                "message": { "role": "user", "content": leaked_payload }
            }),
            json!({
                "uuid": "polluted-assistant",
                "timestamp": "2026-06-27T11:00:30.000Z",
                "message": {
                    "role": "assistant",
                    "content": "用户发了一条\"你好\"的消息。"
                }
            }),
            json!({
                "uuid": "real-user",
                "timestamp": "2026-06-27T11:01:00.000Z",
                "cwd": workspace_path.to_string_lossy(),
                "message": { "role": "user", "content": "第二次真实问题" }
            }),
            json!({
                "uuid": "real-assistant",
                "timestamp": "2026-06-27T11:02:00.000Z",
                "message": { "role": "assistant", "content": "第二次真实回答" }
            }),
        ],
        "\n",
    );

    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];
    let outcome = scan_session_source_file(&session_path, &attribution_scopes, true).await;
    let fact = outcome.fact.expect("quarantined stream-json fact");
    assert_eq!(
        fact.first_real_user_message.as_deref(),
        Some("第二次真实问题")
    );
    assert_eq!(fact.message_count, 2);

    let loaded = load_claude_session_from_base_dir(&base_dir, &workspace_path, &session_id)
        .await
        .expect("load quarantined session");
    assert_eq!(loaded.messages.len(), 2);
    assert!(loaded
        .messages
        .iter()
        .all(|message| !message.text.contains("用户发了一条")));
    assert!(loaded.messages.iter().any(|message| {
        message.id == "real-user" && message.role == "user" && message.text == "第二次真实问题"
    }));

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn stream_json_stdin_payload_with_only_polluted_assistant_echo_stays_hidden() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-stream-json-empty-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_id = format!("stream-json-empty-{}", unique);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));
    let leaked_payload = json!({
        "message": {
            "content": [{ "text": "你好", "type": "text" }],
            "role": "user"
        },
        "type": "user"
    })
    .to_string();
    write_jsonl_lines(
        &session_path,
        &[
            json!({
                "uuid": "polluted-user",
                "timestamp": "2026-06-27T11:00:00.000Z",
                "cwd": workspace_path.to_string_lossy(),
                "message": { "role": "user", "content": leaked_payload }
            }),
            json!({
                "uuid": "polluted-assistant",
                "timestamp": "2026-06-27T11:00:30.000Z",
                "message": {
                    "role": "assistant",
                    "content": "你好！有什么可以帮你的？"
                }
            }),
        ],
        "\n",
    );

    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];
    let outcome = scan_session_source_file(&session_path, &attribution_scopes, true).await;
    assert!(outcome.fact.is_none());

    let loaded = load_claude_session_from_base_dir(&base_dir, &workspace_path, &session_id)
        .await
        .expect("load hidden polluted session");
    assert!(loaded.messages.is_empty());

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn source_fact_cache_hits_and_invalidates_by_fingerprint() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-cache-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let cache_dir = temp_root.join("source-fact-cache");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_id = format!("cache-{}", unique);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));
    write_jsonl_lines(
        &session_path,
        &[json!({
            "uuid": "user-1",
            "timestamp": "2026-05-09T08:00:00.000Z",
            "cwd": workspace_path.to_string_lossy(),
            "message": { "role": "user", "content": "Cache this source fact" }
        })],
        "\n",
    );
    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];

    let first = list_claude_session_source_facts_from_base_dir(
        &base_dir,
        &workspace_path,
        &attribution_scopes,
        Some(20),
        Some(&cache_dir),
    )
    .await
    .expect("first scan");
    assert_eq!(first.facts.len(), 1);
    assert_eq!(first.cache_metrics.hits, 0);
    assert!(first.cache_metrics.misses >= 1);
    assert!(first.cache_metrics.rebuilds >= 1);

    let second = list_claude_session_source_facts_from_base_dir(
        &base_dir,
        &workspace_path,
        &attribution_scopes,
        Some(20),
        Some(&cache_dir),
    )
    .await
    .expect("second scan");
    assert_eq!(second.facts.len(), 1);
    assert!(second.cache_metrics.hits >= 1);
    assert_eq!(second.cache_metrics.rebuilds, 0);

    std::thread::sleep(std::time::Duration::from_millis(5));
    write_jsonl_lines(
        &session_path,
        &[
            json!({
                "uuid": "user-1",
                "timestamp": "2026-05-09T08:00:00.000Z",
                "cwd": workspace_path.to_string_lossy(),
                "message": { "role": "user", "content": "Cache this source fact" }
            }),
            json!({
                "uuid": "assistant-1",
                "timestamp": "2026-05-09T08:00:01.000Z",
                "message": { "role": "assistant", "content": "Changed" }
            }),
        ],
        "\n",
    );

    let stale = list_claude_session_source_facts_from_base_dir(
        &base_dir,
        &workspace_path,
        &attribution_scopes,
        Some(20),
        Some(&cache_dir),
    )
    .await
    .expect("stale scan");
    assert_eq!(stale.facts[0].message_count, 2);
    assert!(stale.cache_metrics.stale >= 1);
    assert!(stale.cache_metrics.rebuilds >= 1);

    std::fs::remove_dir_all(&cache_dir).expect("delete cache");
    let rebuilt = list_claude_session_source_facts_from_base_dir(
        &base_dir,
        &workspace_path,
        &attribution_scopes,
        Some(20),
        Some(&cache_dir),
    )
    .await
    .expect("deleted cache rebuild");
    assert_eq!(rebuilt.facts[0].message_count, 2);
    assert!(rebuilt.cache_metrics.misses >= 1);
    assert!(rebuilt.cache_metrics.rebuilds >= 1);

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn source_fact_cache_is_scoped_by_attribution_context() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-cache-scope-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let cache_dir = temp_root.join("source-fact-cache");
    let workspace_path = temp_root.join("workspace");
    let unrelated_workspace_path = temp_root.join("unrelated");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    std::fs::create_dir_all(&unrelated_workspace_path).expect("create unrelated path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_id = format!("cache-scope-{}", unique);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));
    write_jsonl_lines(
        &session_path,
        &[json!({
            "uuid": "user-1",
            "timestamp": "2026-05-24T01:00:00.000Z",
            "cwd": workspace_path.to_string_lossy(),
            "sessionId": session_id,
            "message": { "role": "user", "content": "Visible in the owning workspace only" }
        })],
        "\n",
    );

    let unrelated_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        unrelated_workspace_path.clone(),
    )];
    let unrelated = list_claude_session_source_facts_from_base_dir(
        &base_dir,
        &unrelated_workspace_path,
        &unrelated_scopes,
        Some(20),
        Some(&cache_dir),
    )
    .await
    .expect("unrelated scan");
    assert!(unrelated.facts.is_empty());
    assert!(unrelated.cache_metrics.rebuilds >= 1);

    let owning_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];
    let owning = list_claude_session_source_facts_from_base_dir(
        &base_dir,
        &workspace_path,
        &owning_scopes,
        Some(20),
        Some(&cache_dir),
    )
    .await
    .expect("owning scan");
    assert!(owning
        .facts
        .iter()
        .any(|fact| fact.canonical_session_id == session_id));
    assert_eq!(owning.cache_metrics.hits, 0);
    assert!(owning.cache_metrics.rebuilds >= 1);

    let owning_again = list_claude_session_source_facts_from_base_dir(
        &base_dir,
        &workspace_path,
        &owning_scopes,
        Some(20),
        Some(&cache_dir),
    )
    .await
    .expect("owning cached scan");
    assert!(owning_again.cache_metrics.hits >= 1);
    assert!(owning_again
        .facts
        .iter()
        .any(|fact| fact.canonical_session_id == session_id));

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn source_fact_cache_excludes_full_inline_payloads() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-cache-redact-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let cache_dir = temp_root.join("source-fact-cache");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_path = project_dir.join(format!("cache-redact-{}.jsonl", unique));
    let inline_payload = "b".repeat(512 * 1024);
    write_jsonl_lines(
        &session_path,
        &[json!({
            "uuid": "user-1",
            "timestamp": "2026-05-09T08:00:00.000Z",
            "cwd": workspace_path.to_string_lossy(),
            "message": {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": inline_payload.clone()
                        }
                    },
                    { "type": "text", "text": "Read the visible label" }
                ]
            }
        })],
        "\n",
    );
    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];

    let result = list_claude_session_source_facts_from_base_dir(
        &base_dir,
        &workspace_path,
        &attribution_scopes,
        Some(20),
        Some(&cache_dir),
    )
    .await
    .expect("cache scan");
    assert_eq!(result.facts.len(), 1);
    let cached_payload = std::fs::read_dir(&cache_dir)
        .expect("cache dir")
        .flatten()
        .map(|entry| std::fs::read_to_string(entry.path()).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(!cached_payload.contains(&inline_payload));
    assert!(!cached_payload.contains("base64"));
    assert!(!cached_payload.contains("ownerWorkspaceId"));
    assert!(!cached_payload.contains("archivedAt"));
    assert!(!cached_payload.contains("folderId"));
    assert!(!cached_payload.contains("customTitle"));
    assert!(cached_payload.contains("Read the visible label"));

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn source_fact_cache_corrupt_or_unavailable_falls_back_to_direct_scan() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-cache-fallback-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let cache_dir = temp_root.join("source-fact-cache");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_path = project_dir.join(format!("cache-fallback-{}.jsonl", unique));
    write_jsonl_lines(
        &session_path,
        &[json!({
            "uuid": "user-1",
            "timestamp": "2026-05-09T08:00:00.000Z",
            "cwd": workspace_path.to_string_lossy(),
            "message": { "role": "user", "content": "Fallback should keep this visible" }
        })],
        "\n",
    );
    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];

    let warm = list_claude_session_source_facts_from_base_dir(
        &base_dir,
        &workspace_path,
        &attribution_scopes,
        Some(20),
        Some(&cache_dir),
    )
    .await
    .expect("warm cache");
    assert_eq!(warm.facts.len(), 1);

    for entry in std::fs::read_dir(&cache_dir).expect("cache dir").flatten() {
        std::fs::write(entry.path(), "{not-json").expect("corrupt cache");
    }
    let corrupt = list_claude_session_source_facts_from_base_dir(
        &base_dir,
        &workspace_path,
        &attribution_scopes,
        Some(20),
        Some(&cache_dir),
    )
    .await
    .expect("corrupt fallback");
    assert_eq!(corrupt.facts.len(), 1);
    assert!(corrupt.cache_metrics.failures >= 1);
    assert!(corrupt.cache_metrics.rebuilds >= 1);

    let unavailable_cache = temp_root.join("cache-as-file");
    std::fs::write(&unavailable_cache, "not a dir").expect("cache file");
    let unavailable = list_claude_session_source_facts_from_base_dir(
        &base_dir,
        &workspace_path,
        &attribution_scopes,
        Some(20),
        Some(&unavailable_cache),
    )
    .await
    .expect("unavailable fallback");
    assert_eq!(unavailable.facts.len(), 1);
    assert!(unavailable.cache_metrics.failures >= 1);

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn source_fact_cache_disabled_keeps_projection_facts_equivalent() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-cache-disabled-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let cache_dir = temp_root.join("source-fact-cache");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_path = project_dir.join(format!("cache-disabled-{}.jsonl", unique));
    write_jsonl_lines(
        &session_path,
        &[json!({
            "uuid": "user-1",
            "timestamp": "2026-05-09T08:00:00.000Z",
            "cwd": workspace_path.to_string_lossy(),
            "message": { "role": "user", "content": "Same fact with or without cache" }
        })],
        "\n",
    );
    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];

    let uncached = list_claude_session_source_facts_from_base_dir(
        &base_dir,
        &workspace_path,
        &attribution_scopes,
        Some(20),
        None,
    )
    .await
    .expect("uncached scan");
    let cached = list_claude_session_source_facts_from_base_dir(
        &base_dir,
        &workspace_path,
        &attribution_scopes,
        Some(20),
        Some(&cache_dir),
    )
    .await
    .expect("cached scan");

    assert_eq!(
        uncached
            .facts
            .iter()
            .map(|fact| (&fact.canonical_session_id, &fact.first_real_user_message))
            .collect::<Vec<_>>(),
        cached
            .facts
            .iter()
            .map(|fact| (&fact.canonical_session_id, &fact.first_real_user_message))
            .collect::<Vec<_>>()
    );

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[test]
fn control_plane_predicate_detects_codex_initialize_payload() {
    let entry = json!({
        "method": "initialize",
        "params": {
            "clientInfo": { "name": "ccgui", "title": "ccgui" },
            "capabilities": { "experimentalApi": true }
        }
    });

    assert!(is_claude_control_plane_entry(&entry));
}

#[test]
fn control_plane_predicate_detects_codex_app_server_command_text() {
    let entry = json!({
        "uuid": "control-codex-app-server",
        "message": {
            "role": "user",
            "content": "codex app-server"
        }
    });

    assert!(is_claude_control_plane_entry(&entry));
}

#[test]
fn control_plane_predicate_detects_leaked_stream_json_stdin_payload() {
    let leaked_payload = json!({
        "message": {
            "content": [{ "text": "你好", "type": "text" }],
            "role": "user"
        },
        "type": "user"
    })
    .to_string();
    let entry = json!({
        "uuid": "control-stream-json-payload",
        "message": {
            "role": "user",
            "content": leaked_payload
        }
    });

    assert!(is_claude_control_plane_entry(&entry));
}

#[test]
fn control_plane_predicate_does_not_filter_normal_app_server_text() {
    let entry = json!({
        "uuid": "user-normal",
        "message": {
            "role": "user",
            "content": "Please inspect why the app-server keyword appears in logs."
        }
    });

    assert!(!is_claude_control_plane_entry(&entry));
}

#[test]
fn control_plane_predicate_does_not_filter_normal_codex_app_server_text() {
    let entry = json!({
        "uuid": "user-codex-app-server",
        "message": {
            "role": "user",
            "content": "Please inspect why codex app-server appears in logs."
        }
    });

    assert!(!is_claude_control_plane_entry(&entry));
}

#[test]
fn control_plane_predicate_does_not_filter_normal_json_discussion() {
    let entry = json!({
        "uuid": "user-json-discussion",
        "message": {
            "role": "user",
            "content": "{\"message\":\"please explain this JSON\"}"
        }
    });

    assert!(!is_claude_control_plane_entry(&entry));
}

#[test]
fn local_control_classifier_detects_displayable_and_hidden_events() {
    let resume_failure = json!({
        "cwd": "C:\\Users\\fay\\code\\vinci",
        "message": {
            "role": "user",
            "content": "<local-command-stdout>Session \u{1b}[1m1778306483383\u{1b}[22m was not found.</local-command-stdout>"
        }
    });
    let model_changed = json!({
        "cwd": "/Users/fay/code/vinci",
        "message": {
            "role": "user",
            "content": "<local-command-stdout>Set model to \u{1b}[1mMiniMax-M2.7\u{1b}[22m</local-command-stdout>"
        }
    });
    let interrupted = json!({
        "message": {
            "role": "user",
            "content": "[Request interrupted by user]"
        }
    });
    let synthetic = json!({
        "message": {
            "role": "assistant",
            "model": "<synthetic>",
            "content": "No response requested."
        }
    });
    let local_command_system = json!({
        "message": {
            "role": "user",
            "type": "system",
            "subtype": "local_command",
            "content": "local command metadata"
        }
    });
    let natural_text = json!({
        "message": {
            "role": "user",
            "content": "Please explain local-command stdout and resume behavior."
        }
    });

    let resume_classification = classify_claude_history_entry(&resume_failure);
    assert!(matches!(
        resume_classification,
        ClaudeHistoryEntryClassification::Displayable(ref event)
            if event.event_type == ClaudeLocalControlEventType::ResumeFailed
                && event.detail == "Session 1778306483383 was not found."
    ));

    assert!(matches!(
        classify_claude_history_entry(&model_changed),
        ClaudeHistoryEntryClassification::Displayable(ref event)
            if event.event_type == ClaudeLocalControlEventType::ModelChanged
                && event.detail == "Set model to MiniMax-M2.7"
    ));

    assert!(matches!(
        classify_claude_history_entry(&interrupted),
        ClaudeHistoryEntryClassification::Displayable(ref event)
            if event.event_type == ClaudeLocalControlEventType::Interrupted
    ));
    assert!(matches!(
        classify_claude_history_entry(&synthetic),
        ClaudeHistoryEntryClassification::Hidden(ClaudeHistoryHiddenReason::SyntheticRuntime)
    ));
    assert!(matches!(
        classify_claude_history_entry(&local_command_system),
        ClaudeHistoryEntryClassification::Hidden(ClaudeHistoryHiddenReason::InternalRecord)
    ));
    assert_eq!(
        classify_claude_history_entry(&natural_text),
        ClaudeHistoryEntryClassification::Normal
    );
}

#[test]
fn slash_command_user_prompt_with_args_stays_visible() {
    let skill_question = json!({
        "message": {
            "role": "user",
            "content": "<command-message>aimax:code-review</command-message>\n<command-name>/aimax:code-review</command-name>\n<command-args>审查PR802，并告诉我他解决了什么问题，我应不应该合并他</command-args>"
        }
    });
    let resume_command = json!({
        "message": {
            "role": "user",
            "content": "<command-name>/resume</command-name>"
        }
    });
    let empty_args_command = json!({
        "message": {
            "role": "user",
            "content": "<command-message>clear</command-message>\n<command-name>/clear</command-name>\n<command-args></command-args>"
        }
    });

    assert_eq!(
        classify_claude_history_entry(&skill_question),
        ClaudeHistoryEntryClassification::Normal
    );
    assert!(matches!(
        classify_claude_history_entry(&resume_command),
        ClaudeHistoryEntryClassification::Hidden(ClaudeHistoryHiddenReason::InternalRecord)
    ));
    assert!(matches!(
        classify_claude_history_entry(&empty_args_command),
        ClaudeHistoryEntryClassification::Hidden(ClaudeHistoryHiddenReason::InternalRecord)
    ));
}

#[test]
fn command_prompt_text_leaves_mid_text_command_tag_quotes_alone() {
    // 开发者粘贴 transcript 排查问题：普通消息正文里引用 <command-args> 片段，
    // 不是 slash-command 信封，标题必须保持原文（收紧提取触发条件为信封开头，
    // 避免标题被替换成引用内容）。
    let quoted = "请看这段 <command-args>deploy prod</command-args> 是什么含义？我本地复现不出来";
    assert_eq!(extract_command_prompt_text(quoted), quoted);

    // 前导空白后的真信封仍要提取（与 control-plane guard 同用 trimmed 前缀谓词）。
    let indented = "  <command-message>aimax:code-review</command-message>\n<command-name>/aimax:code-review</command-name>\n<command-args>真 prompt</command-args>";
    assert_eq!(extract_command_prompt_text(indented), "真 prompt");
}

#[test]
fn command_prompt_text_unwraps_slash_command_tags_for_session_titles() {
    let wrapped = "<command-message>aimax:code-review</command-message>\n<command-name>/aimax:code-review</command-name>\n<command-args>审查PR802，并告诉我他解决了什么问题</command-args>";
    assert_eq!(
        extract_command_prompt_text(wrapped),
        "审查PR802，并告诉我他解决了什么问题"
    );

    let message_only = "<command-message>clear</command-message>\n<command-args></command-args>";
    assert_eq!(extract_command_prompt_text(message_only), "clear");

    let plain = "普通用户消息保持原样";
    assert_eq!(extract_command_prompt_text(plain), plain);
}

#[test]
fn continuation_summary_classifier_detects_synthetic_runtime_without_keyword_overfiltering() {
    let synthetic_summary = json!({
        "uuid": "synthetic-summary",
        "timestamp": "2026-05-09T09:00:00.000Z",
        "isVisibleInTranscriptOnly": true,
        "isCompactSummary": true,
        "message": {
            "role": "user",
            "content": synthetic_continuation_summary_text()
        }
    });
    let pasted_summary_discussion = json!({
        "uuid": "real-pasted-summary-discussion",
        "timestamp": "2026-05-09T09:00:01.000Z",
        "message": {
            "role": "user",
            "content": synthetic_continuation_summary_text()
        }
    });
    let normal_question = json!({
        "uuid": "real-user-summary-question",
        "message": {
            "role": "user",
            "content": "Why did `This session is being continued from a previous conversation` appear in my chat?"
        }
    });

    assert_eq!(
        classify_claude_history_entry(&synthetic_summary),
        ClaudeHistoryEntryClassification::Hidden(ClaudeHistoryHiddenReason::SyntheticRuntime)
    );
    assert_eq!(
        classify_claude_history_entry(&pasted_summary_discussion),
        ClaudeHistoryEntryClassification::Normal
    );
    assert_eq!(
        classify_claude_history_entry(&normal_question),
        ClaudeHistoryEntryClassification::Normal
    );
}

#[tokio::test]
async fn list_claude_sessions_uses_transcript_cwd_when_project_dir_does_not_match_workspace() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-cwd-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    let unrelated_path = temp_root.join("unrelated");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    std::fs::create_dir_all(&unrelated_path).expect("create unrelated path");
    std::fs::create_dir_all(&base_dir).expect("create base dir");

    let encoded_unrelated = unrelated_path
        .to_string_lossy()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>();
    let project_dir = base_dir.join(encoded_unrelated);
    std::fs::create_dir_all(&project_dir).expect("create unrelated claude project dir");

    let session_id = format!("cwd-match-{}", unique);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));
    let line = json!({
        "uuid": "user-turn-1",
        "timestamp": "2026-04-12T12:00:00.000Z",
        "cwd": workspace_path.join("src").to_string_lossy(),
        "message": {
            "role": "user",
            "content": "fix the sidebar session history"
        }
    });
    std::fs::write(&session_path, format!("{}\n", line)).expect("write session");

    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];
    let sessions =
        list_claude_sessions_from_base_dir(&base_dir, &workspace_path, &attribution_scopes, None)
            .await
            .expect("list claude sessions");
    let summary = sessions
        .iter()
        .find(|session| session.session_id == session_id)
        .expect("cwd matched session should be visible");
    assert_eq!(
        summary.attribution_status.as_deref(),
        Some(CLAUDE_ATTRIBUTION_STRICT_MATCH)
    );
    assert_eq!(
        summary.attribution_reason.as_deref(),
        Some(CLAUDE_ATTRIBUTION_REASON_TRANSCRIPT_CWD)
    );
    assert_eq!(
        summary.cwd.as_deref(),
        Some(workspace_path.join("src").to_string_lossy().as_ref())
    );

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn list_claude_sessions_uses_git_root_evidence_when_cwd_is_outside_workspace_path() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-git-root-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace").join("packages").join("app");
    let git_root = temp_root.join("workspace");
    let unrelated_path = temp_root.join("unrelated");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    std::fs::create_dir_all(git_root.join("tools")).expect("create git-root child path");
    std::fs::create_dir_all(&unrelated_path).expect("create unrelated path");
    std::fs::create_dir_all(&base_dir).expect("create base dir");

    let encoded_unrelated = unrelated_path
        .to_string_lossy()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>();
    let project_dir = base_dir.join(encoded_unrelated);
    std::fs::create_dir_all(&project_dir).expect("create unrelated claude project dir");

    let session_id = format!("git-root-match-{}", unique);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));
    let line = json!({
        "uuid": "user-turn-1",
        "timestamp": "2026-04-12T12:00:00.000Z",
        "cwd": git_root.join("tools").to_string_lossy(),
        "message": {
            "role": "user",
            "content": "inspect repo scripts"
        }
    });
    std::fs::write(&session_path, format!("{}\n", line)).expect("write session");

    let attribution_scopes = vec![
        ClaudeSessionAttributionScope::workspace_path(workspace_path.clone()),
        ClaudeSessionAttributionScope::git_root(git_root.clone()),
    ];
    let sessions =
        list_claude_sessions_from_base_dir(&base_dir, &workspace_path, &attribution_scopes, None)
            .await
            .expect("list claude sessions");
    let summary = sessions
        .iter()
        .find(|session| session.session_id == session_id)
        .expect("git-root matched session should be visible");

    assert_eq!(
        summary.attribution_reason.as_deref(),
        Some(CLAUDE_ATTRIBUTION_REASON_GIT_ROOT)
    );
    assert_eq!(
        summary.attribution_status.as_deref(),
        Some(CLAUDE_ATTRIBUTION_STRICT_MATCH)
    );

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn load_claude_session_parses_reasoning_blocks() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-history-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    std::fs::create_dir_all(&base_dir).expect("create base dir");

    let project_dir = create_project_dir(&base_dir, &workspace_path);

    let session_id = format!("reasoning-block-{}", unique);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));
    let line = json!({
        "uuid": "assistant-turn-1",
        "timestamp": "2026-04-12T12:00:00.000Z",
        "message": {
            "role": "assistant",
            "content": [
                {
                    "type": "reasoning",
                    "reasoning": "Inspect runtime state and compare the latest snapshots"
                },
                {
                    "type": "text",
                    "text": "Done"
                }
            ]
        }
    });
    std::fs::write(&session_path, format!("{}\n", line)).expect("write session");

    let result = load_claude_session_from_base_dir(&base_dir, &workspace_path, &session_id)
        .await
        .expect("load session");
    let reasoning = result
        .messages
        .iter()
        .find(|message| message.kind == "reasoning")
        .expect("reasoning message");
    assert_eq!(
        reasoning.text,
        "Inspect runtime state and compare the latest snapshots"
    );
    assert!(result
        .messages
        .iter()
        .any(|message| message.kind == "message" && message.text == "Done"));

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn load_claude_session_formats_local_control_events_and_hides_internal_rows() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-local-control-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    std::fs::create_dir_all(&base_dir).expect("create base dir");
    let project_dir = create_project_dir(&base_dir, &workspace_path);

    let session_id = format!("local-control-{}", unique);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));
    let lines = vec![
        json!({
            "timestamp": "2026-05-09T07:40:00.000Z",
            "type": "permission-mode",
            "cwd": workspace_path.to_string_lossy(),
            "message": { "role": "user", "content": "default" }
        }),
        json!({
            "uuid": "resume-cmd",
            "timestamp": "2026-05-09T07:41:00.000Z",
            "cwd": workspace_path.to_string_lossy(),
            "message": { "role": "user", "content": "<command-name>/resume</command-name>" }
        }),
        json!({
            "uuid": "resume-result",
            "timestamp": "2026-05-09T07:41:01.000Z",
            "cwd": workspace_path.to_string_lossy(),
            "message": { "role": "user", "content": "<local-command-stdout>Session \u{1b}[1m1778306483383\u{1b}[22m was not found.</local-command-stdout>" }
        }),
        json!({
            "uuid": "model-result",
            "timestamp": "2026-05-09T07:42:01.000Z",
            "cwd": workspace_path.to_string_lossy(),
            "message": { "role": "user", "content": "<local-command-stdout>Set model to \u{1b}[1mMiniMax-M2.7\u{1b}[22m</local-command-stdout>" }
        }),
        json!({
            "uuid": "interrupted",
            "timestamp": "2026-05-09T07:43:01.000Z",
            "cwd": workspace_path.to_string_lossy(),
            "message": { "role": "user", "content": "[Request interrupted by user]" }
        }),
        json!({
            "uuid": "synthetic-no-response",
            "timestamp": "2026-05-09T07:44:01.000Z",
            "message": {
                "role": "assistant",
                "model": "<synthetic>",
                "content": "No response requested."
            }
        }),
        json!({
            "uuid": "real-user",
            "timestamp": "2026-05-09T07:45:01.000Z",
            "cwd": workspace_path.to_string_lossy(),
            "message": { "role": "user", "content": "你好" }
        }),
        json!({
            "uuid": "real-assistant",
            "timestamp": "2026-05-09T07:46:01.000Z",
            "message": { "role": "assistant", "content": "你好，湘宁大兄弟！" }
        }),
    ];
    write_jsonl_lines(&session_path, &lines, "\r\n");

    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];
    let sessions =
        list_claude_sessions_from_base_dir(&base_dir, &workspace_path, &attribution_scopes, None)
            .await
            .expect("list claude sessions");
    let summary = sessions
        .iter()
        .find(|session| session.session_id == session_id)
        .expect("mixed local-control session should remain visible");
    assert_eq!(summary.first_message, "你好");
    assert_eq!(summary.message_count, 2);

    let result = load_claude_session_from_base_dir(&base_dir, &workspace_path, &session_id)
        .await
        .expect("load session");
    let control_events = result
        .messages
        .iter()
        .filter(|message| message.tool_type.as_deref() == Some(CLAUDE_CONTROL_EVENT_TOOL_TYPE))
        .collect::<Vec<_>>();
    assert_eq!(control_events.len(), 3);
    assert!(control_events.iter().any(|message| {
        message.text == "Session 1778306483383 was not found."
            && message.status.as_deref() == Some("failed")
            && message
                .tool_input
                .as_ref()
                .and_then(|value| value.get("eventType"))
                .and_then(serde_json::Value::as_str)
                == Some("resumeFailed")
    }));
    assert!(control_events.iter().any(|message| {
        message.text == "Set model to MiniMax-M2.7"
            && message
                .tool_input
                .as_ref()
                .and_then(|value| value.get("eventType"))
                .and_then(serde_json::Value::as_str)
                == Some("modelChanged")
    }));
    assert!(control_events.iter().any(|message| {
        message.text == "[Request interrupted by user]"
            && message
                .tool_input
                .as_ref()
                .and_then(|value| value.get("eventType"))
                .and_then(serde_json::Value::as_str)
                == Some("interrupted")
    }));
    assert!(!result
        .messages
        .iter()
        .any(|message| message.text.contains("<local-command-stdout>")
            || message.text.contains("<command-name>")
            || message.text == "No response requested."));
    assert!(result
        .messages
        .iter()
        .any(|message| message.id == "real-user" && message.text == "你好"));

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn list_claude_sessions_peeks_head_and_caps_by_mtime() {
    let unique = Uuid::new_v4().to_string();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-list-preview-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace path");
    std::fs::create_dir_all(&base_dir).expect("create base dir");
    let project_dir = create_project_dir(&base_dir, &workspace_path);

    let newest_id = format!("newest-{}", unique);
    let older_id = format!("older-{}", unique);
    let newest_path = project_dir.join(format!("{}.jsonl", newest_id));
    let older_path = project_dir.join(format!("{}.jsonl", older_id));

    let mut newest_lines = vec![json!({
        "uuid": "newest-user",
        "timestamp": "2026-05-09T08:00:00.000Z",
        "session_id": newest_id,
        "cwd": workspace_path.to_string_lossy(),
        "message": { "role": "user", "content": "newest first prompt" }
    })];
    for index in 0..80 {
        newest_lines.push(json!({
            "uuid": format!("padding-{index}"),
            "timestamp": "2026-05-09T08:00:01.000Z",
            "session_id": newest_id,
            "cwd": workspace_path.to_string_lossy(),
            "message": { "role": "assistant", "content": format!("padding {index}") }
        }));
    }
    newest_lines.push(json!({
        "type": "custom-title",
        "customTitle": "late title after peek window",
        "timestamp": "2026-05-09T09:00:00.000Z",
        "session_id": newest_id,
        "cwd": workspace_path.to_string_lossy()
    }));
    write_jsonl_lines(&newest_path, &newest_lines, "\n");
    write_jsonl_lines(
        &older_path,
        &[json!({
            "uuid": "older-user",
            "timestamp": "2026-04-01T08:00:00.000Z",
            "session_id": older_id,
            "cwd": workspace_path.to_string_lossy(),
            "message": { "role": "user", "content": "older session" }
        })],
        "\n",
    );

    let older_mtime = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(100);
    let newer_mtime = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(200);
    let older_file = std::fs::File::open(&older_path).expect("open older");
    older_file
        .set_modified(older_mtime)
        .expect("set older mtime");
    let newest_file = std::fs::File::open(&newest_path).expect("open newest");
    newest_file
        .set_modified(newer_mtime)
        .expect("set newest mtime");

    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.clone(),
    )];
    let sessions = list_claude_sessions_from_base_dir(
        &base_dir,
        &workspace_path,
        &attribution_scopes,
        Some(1),
    )
    .await
    .expect("list newest only");

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, newest_id);
    assert_eq!(sessions[0].first_message, "newest first prompt");
    assert_ne!(
        sessions[0].native_title.as_deref(),
        Some("late title after peek window")
    );
    assert_eq!(sessions[0].updated_at, 200_000);

    let _ = std::fs::remove_dir_all(&temp_root);
}
