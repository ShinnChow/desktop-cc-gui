use super::*;

#[tokio::test]
async fn delete_codex_session_for_workspace_physically_removes_matching_file() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let session_path = write_named_session_file(
            &sessions_root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-alpha",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                    .to_string(),
            ],
        );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let deleted_count =
        delete_codex_session_for_workspace(&workspaces, "workspace-id", "session-alpha")
            .await
            .expect("delete codex session");

    assert_eq!(deleted_count, 1);
    assert!(!session_path.exists());
}

#[tokio::test]
async fn delete_codex_sessions_for_workspace_reuses_single_scan_for_multiple_targets() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let session_path_a = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
            .to_string()],
    );
    let session_path_b = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-05-00-session-beta",
        &[r#"{"timestamp":"2026-01-19T12:05:00.000Z","type":"session_meta","payload":{"id":"session-beta","cwd":"/tmp/project-alpha"}}"#
            .to_string()],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let deleted = delete_codex_sessions_for_workspace(
        &workspaces,
        "workspace-id",
        &["session-alpha".to_string(), "session-beta".to_string()],
    )
    .await
    .expect("batch delete codex sessions");

    assert_eq!(deleted.len(), 2);
    assert!(deleted.iter().all(|result| result.deleted));
    assert!(!session_path_a.exists());
    assert!(!session_path_b.exists());
}

#[tokio::test]
async fn delete_codex_session_for_workspace_rejects_ambiguous_unknown_candidates() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let archived_root = codex_home.join("archived_sessions");
    let day_key = "2026-01-19";
    let session_path_a = write_named_session_file(
            &sessions_root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-alpha",
            &[r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha"}}"#
                .to_string()],
        );
    let session_path_b = write_named_session_file(
            &archived_root,
            day_key,
            "rollout-2026-01-19T12-05-00-session-alpha",
            &[r#"{"timestamp":"2026-01-19T12:05:00.000Z","type":"session_meta","payload":{"id":"session-alpha"}}"#
                .to_string()],
        );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let error = delete_codex_session_for_workspace(&workspaces, "workspace-id", "session-alpha")
        .await
        .expect_err("ambiguous unknown candidates should fail");

    assert!(error.contains("ambiguous codex session files"));
    assert!(session_path_a.exists());
    assert!(session_path_b.exists());
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_truncates_source_session_before_target_user_turn() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let source_path = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"first user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"event_msg","payload":{"type":"agent_message","message":"first reply"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:03.000Z","type":"event_msg","payload":{"type":"user_message","message":"second user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:04.000Z","type":"event_msg","payload":{"type":"agent_message","message":"second reply"}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let result = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session-beta",
        1,
        None,
        None,
    )
    .await
    .expect("commit codex rewind");

    assert_eq!(result.deleted_count, 1);
    assert!(!source_path.exists());

    let target_path = sessions_root
        .join("2026")
        .join("01")
        .join("19")
        .join("rewind-session-beta.jsonl");
    assert!(target_path.exists());

    let content = fs::read_to_string(&target_path).expect("read rewind target");
    assert!(content.contains(r#""id":"session-beta""#));
    assert!(content.contains("first user"));
    assert!(content.contains("first reply"));
    assert!(!content.contains("second user"));
    assert!(!content.contains("second reply"));
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_reopen_reads_only_truncated_target_session() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"first user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"event_msg","payload":{"type":"agent_message","message":"first reply"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:03.000Z","type":"event_msg","payload":{"type":"user_message","message":"second user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:04.000Z","type":"event_msg","payload":{"type":"agent_message","message":"second reply"}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session-beta",
        1,
        None,
        None,
    )
    .await
    .expect("commit codex rewind");

    let reopened_entries = load_codex_session_entries(
        "session-beta",
        Path::new("/tmp/project-alpha"),
        &[sessions_root],
    )
    .expect("reopen rewound session");

    let reopened_payload = reopened_entries
        .iter()
        .map(|entry| serde_json::to_string(entry).expect("serialize rewound entry"))
        .collect::<Vec<_>>()
        .join("\n");

    assert!(reopened_payload.contains(r#""id":"session-beta""#));
    assert!(reopened_payload.contains("first user"));
    assert!(reopened_payload.contains("first reply"));
    assert!(!reopened_payload.contains("second user"));
    assert!(!reopened_payload.contains("second reply"));
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_keeps_source_when_target_turn_is_missing() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let source_path = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"first user"}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let error = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session-beta",
        2,
        None,
        None,
    )
    .await
    .expect_err("missing target user turn should fail");

    assert!(error.contains("target user turn"));
    assert!(source_path.exists());
    assert!(!sessions_root
        .join("2026")
        .join("01")
        .join("19")
        .join("rewind-session-beta.jsonl")
        .exists());
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_drops_response_item_user_when_mirrored_by_event_msg() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let source_path = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"first user"}]}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"event_msg","payload":{"type":"user_message","message":"first user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:03.000Z","type":"event_msg","payload":{"type":"agent_message","message":"first reply"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:04.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"second user"}]}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:05.000Z","type":"event_msg","payload":{"type":"user_message","message":"second user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:06.000Z","type":"event_msg","payload":{"type":"agent_message","message":"second reply"}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let result = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session-beta",
        1,
        None,
        None,
    )
    .await
    .expect("commit codex rewind");

    assert_eq!(result.deleted_count, 1);
    assert!(!source_path.exists());

    let target_path = sessions_root
        .join("2026")
        .join("01")
        .join("19")
        .join("rewind-session-beta.jsonl");
    assert!(target_path.exists());

    let content = fs::read_to_string(&target_path).expect("read rewind target");
    assert!(content.contains("first user"));
    assert!(content.contains("first reply"));
    assert!(!content.contains("second user"));
    assert!(!content.contains("second reply"));
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_supports_response_item_user_without_event_msg() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let source_path = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"first user only response"}]}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"first reply only response"}]}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:03.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"second user only response"}]}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:04.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"second reply only response"}]}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let result = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session-beta",
        1,
        None,
        None,
    )
    .await
    .expect("commit codex rewind");

    assert_eq!(result.deleted_count, 1);
    assert!(!source_path.exists());

    let target_path = sessions_root
        .join("2026")
        .join("01")
        .join("19")
        .join("rewind-session-beta.jsonl");
    assert!(target_path.exists());

    let content = fs::read_to_string(&target_path).expect("read rewind target");
    assert!(content.contains("first user only response"));
    assert!(content.contains("first reply only response"));
    assert!(!content.contains("second user only response"));
    assert!(!content.contains("second reply only response"));
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_aligns_target_index_when_source_has_hidden_injected_user(
) {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let source_path = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r##"{"timestamp":"2026-01-19T12:00:00.100Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# injected prompt"}]}}"##
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"first user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"event_msg","payload":{"type":"agent_message","message":"first reply"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:03.000Z","type":"event_msg","payload":{"type":"user_message","message":"second user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:04.000Z","type":"event_msg","payload":{"type":"agent_message","message":"second reply"}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let result = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session-beta",
        1,
        None,
        Some(2),
    )
    .await
    .expect("commit codex rewind");

    assert_eq!(result.deleted_count, 1);
    assert!(!source_path.exists());

    let target_path = sessions_root
        .join("2026")
        .join("01")
        .join("19")
        .join("rewind-session-beta.jsonl");
    assert!(target_path.exists());

    let content = fs::read_to_string(&target_path).expect("read rewind target");
    assert!(content.contains("# injected prompt"));
    assert!(content.contains("first user"));
    assert!(content.contains("first reply"));
    assert!(!content.contains("second user"));
    assert!(!content.contains("second reply"));
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_does_not_shift_index_when_source_has_fewer_user_turns_than_local(
) {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let source_path = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"first user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"event_msg","payload":{"type":"agent_message","message":"first reply"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:03.000Z","type":"event_msg","payload":{"type":"user_message","message":"second user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:04.000Z","type":"event_msg","payload":{"type":"agent_message","message":"second reply"}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let result = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session-beta",
        1,
        None,
        Some(3),
    )
    .await
    .expect("commit codex rewind");

    assert_eq!(result.deleted_count, 1);
    assert!(!source_path.exists());

    let target_path = sessions_root
        .join("2026")
        .join("01")
        .join("19")
        .join("rewind-session-beta.jsonl");
    assert!(target_path.exists());

    let content = fs::read_to_string(&target_path).expect("read rewind target");
    assert!(content.contains("first user"));
    assert!(content.contains("first reply"));
    assert!(!content.contains("second user"));
    assert!(!content.contains("second reply"));
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_rejects_invalid_session_id_segments() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let source_error = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "../session-alpha",
        "session-beta",
        1,
        None,
        None,
    )
    .await
    .expect_err("invalid source id should fail");
    assert!(source_error.contains("invalid source_session_id"));

    let target_error = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session/child",
        1,
        None,
        None,
    )
    .await
    .expect_err("invalid target id should fail");
    assert!(target_error.contains("invalid target_session_id"));
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_writes_cross_platform_safe_rewind_filename() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let source_path = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"first user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"event_msg","payload":{"type":"agent_message","message":"first reply"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:03.000Z","type":"event_msg","payload":{"type":"user_message","message":"second user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:04.000Z","type":"event_msg","payload":{"type":"agent_message","message":"second reply"}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let result = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session:beta?1",
        1,
        None,
        None,
    )
    .await
    .expect("commit codex rewind");
    assert_eq!(result.deleted_count, 1);
    assert!(!source_path.exists());

    let day_dir = sessions_root.join("2026").join("01").join("19");
    let rewind_paths: Vec<PathBuf> = fs::read_dir(&day_dir)
        .expect("read day directory")
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("rewind-") && name.ends_with(".jsonl"))
                .unwrap_or(false)
        })
        .collect();
    assert_eq!(rewind_paths.len(), 1);

    let rewind_name = rewind_paths[0]
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    assert!(!rewind_name.contains(':'));
    assert!(!rewind_name.contains('?'));

    let content = fs::read_to_string(&rewind_paths[0]).expect("read rewind target");
    assert!(content.contains(r#""id":"session:beta?1""#));
}

