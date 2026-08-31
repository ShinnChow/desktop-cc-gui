use super::*;
use crate::types::{WorkspaceKind, WorkspaceSettings};
use chrono::NaiveDateTime;
use std::io::Write;
use std::path::Path;
use std::{fs, path::PathBuf};
use uuid::Uuid;

fn write_temp_jsonl(lines: &[&str]) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("ccgui-local-usage-test-{}.jsonl", Uuid::new_v4()));
    let mut file = File::create(&path).expect("create temp jsonl");
    for line in lines {
        writeln!(file, "{line}").expect("write jsonl line");
    }
    path
}

fn make_temp_sessions_root() -> PathBuf {
    let mut root = std::env::temp_dir();
    root.push(format!("ccgui-local-usage-root-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).expect("create temp root");
    root
}

fn write_session_file(root: &Path, day_key: &str, lines: &[String]) -> PathBuf {
    let day_dir = day_dir_for_key(root, day_key);
    fs::create_dir_all(&day_dir).expect("create day dir");
    let path = day_dir.join(format!("usage-{}.jsonl", Uuid::new_v4()));
    let mut file = File::create(&path).expect("create session jsonl");
    for line in lines {
        writeln!(file, "{line}").expect("write jsonl line");
    }
    path
}

fn write_named_session_file(
    root: &Path,
    day_key: &str,
    session_id: &str,
    lines: &[String],
) -> PathBuf {
    let day_dir = day_dir_for_key(root, day_key);
    fs::create_dir_all(&day_dir).expect("create day dir");
    let path = day_dir.join(format!("{session_id}.jsonl"));
    let mut file = File::create(&path).expect("create session jsonl");
    for line in lines {
        writeln!(file, "{line}").expect("write jsonl line");
    }
    path
}

fn write_codex_session_index(codex_home: &Path, lines: &[String]) {
    fs::create_dir_all(codex_home).expect("create codex home");
    let mut file =
        File::create(codex_home.join("session_index.jsonl")).expect("create codex session index");
    for line in lines {
        writeln!(file, "{line}").expect("write codex session index line");
    }
}

#[test]
fn scan_file_does_not_double_count_last_and_total_usage() {
    let day_key = "2026-01-19";
    let path = write_temp_jsonl(&[
        r#"{"timestamp":"2026-01-19T12:00:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#,
        r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#,
    ]);

    let mut daily: HashMap<String, DailyTotals> = HashMap::new();
    daily.insert(day_key.to_string(), DailyTotals::default());
    let mut model_totals: HashMap<String, i64> = HashMap::new();
    scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

    let totals = daily.get(day_key).copied().unwrap_or_default();
    assert_eq!(totals.input, 10);
    assert_eq!(totals.output, 5);
}

#[test]
fn scan_file_counts_last_deltas_before_total_snapshot_once() {
    let day_key = "2026-01-19";
    let path = write_temp_jsonl(&[
        r#"{"timestamp":"2026-01-19T12:00:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#,
        r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":20,"cached_input_tokens":0,"output_tokens":10}}}}"#,
    ]);

    let mut daily: HashMap<String, DailyTotals> = HashMap::new();
    daily.insert(day_key.to_string(), DailyTotals::default());
    let mut model_totals: HashMap<String, i64> = HashMap::new();
    scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

    let totals = daily.get(day_key).copied().unwrap_or_default();
    assert_eq!(totals.input, 20);
    assert_eq!(totals.output, 10);
}

#[test]
fn scan_file_does_not_double_count_last_between_total_snapshots() {
    let day_key = "2026-01-19";
    let path = write_temp_jsonl(&[
        r#"{"timestamp":"2026-01-19T12:00:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#,
        r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":2,"cached_input_tokens":0,"output_tokens":1}}}}"#,
        r#"{"timestamp":"2026-01-19T12:00:02.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":6}}}}"#,
    ]);

    let mut daily: HashMap<String, DailyTotals> = HashMap::new();
    daily.insert(day_key.to_string(), DailyTotals::default());
    let mut model_totals: HashMap<String, i64> = HashMap::new();
    scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

    let totals = daily.get(day_key).copied().unwrap_or_default();
    assert_eq!(totals.input, 12);
    assert_eq!(totals.output, 6);
}

#[test]
fn scan_file_tracks_agent_time_from_activity() {
    let day_key = "2026-01-19";
    let path = write_temp_jsonl(&[
        r#"{"timestamp":"2026-01-19T12:00:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}}}"#,
        r#"{"timestamp":"2026-01-19T12:00:05.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2,"cached_input_tokens":0,"output_tokens":2}}}}"#,
    ]);

    let mut daily: HashMap<String, DailyTotals> = HashMap::new();
    daily.insert(day_key.to_string(), DailyTotals::default());
    let mut model_totals: HashMap<String, i64> = HashMap::new();
    scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

    let totals = daily.get(day_key).copied().unwrap_or_default();
    assert_eq!(totals.agent_ms, 5_000);
}

#[test]
fn scan_file_counts_runs_from_assistant_messages() {
    let day_key = "2026-01-19";
    let path = write_temp_jsonl(&[
        r#"{"timestamp":"2026-01-19T12:00:05.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"a"}]}}"#,
        r#"{"timestamp":"2026-01-19T12:00:10.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"b"}]}}"#,
    ]);

    let mut daily: HashMap<String, DailyTotals> = HashMap::new();
    daily.insert(day_key.to_string(), DailyTotals::default());
    let mut model_totals: HashMap<String, i64> = HashMap::new();
    scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

    let totals = daily.get(day_key).copied().unwrap_or_default();
    assert_eq!(totals.agent_runs, 2);
}

#[test]
fn scan_file_ignores_large_gaps_between_activity() {
    let day_key = "2026-01-19";
    let path = write_temp_jsonl(&[
        r#"{"timestamp":"2026-01-19T12:00:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}}}"#,
        r#"{"timestamp":"2026-01-19T12:10:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2,"cached_input_tokens":0,"output_tokens":2}}}}"#,
        r#"{"timestamp":"2026-01-19T12:10:10.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":3,"cached_input_tokens":0,"output_tokens":3}}}}"#,
    ]);

    let mut daily: HashMap<String, DailyTotals> = HashMap::new();
    daily.insert(day_key.to_string(), DailyTotals::default());
    let mut model_totals: HashMap<String, i64> = HashMap::new();
    scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

    let totals = daily.get(day_key).copied().unwrap_or_default();
    assert_eq!(totals.agent_ms, 10_000);
}

#[test]
fn scan_file_skips_workspace_mismatch() {
    let day_key = "2026-01-19";
    let path = write_temp_jsonl(&[
        r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/project-alpha"}}"#,
        r#"{"timestamp":"2026-01-19T12:00:10.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}}"#,
        r#"{"timestamp":"2026-01-19T12:00:12.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#,
    ]);

    let mut daily: HashMap<String, DailyTotals> = HashMap::new();
    daily.insert(day_key.to_string(), DailyTotals::default());
    let mut model_totals: HashMap<String, i64> = HashMap::new();
    scan_file(
        &path,
        &mut daily,
        &mut model_totals,
        Some(Path::new("/tmp/other-project")),
    )
    .expect("scan file");

    let totals = daily.get(day_key).copied().unwrap_or_default();
    assert_eq!(totals.agent_ms, 0);
    assert_eq!(totals.input, 0);
}

#[test]
fn scan_local_usage_aggregates_multiple_session_roots() {
    let day_keys = make_day_keys(2);
    let day_key = day_keys
        .last()
        .cloned()
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    let naive = NaiveDateTime::parse_from_str(&format!("{day_key} 12:00:00"), "%Y-%m-%d %H:%M:%S")
        .expect("timestamp");
    let timestamp_ms = Local
        .from_local_datetime(&naive)
        .single()
        .expect("timestamp")
        .timestamp_millis();

    let root_a = make_temp_sessions_root();
    let root_b = make_temp_sessions_root();

    let line_a = format!(
        r#"{{"timestamp":{timestamp_ms},"payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":5,"cached_input_tokens":0,"output_tokens":2}}}}}}}}"#
    );
    let line_b = format!(
        r#"{{"timestamp":{timestamp_ms},"payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":3,"cached_input_tokens":0,"output_tokens":1}}}}}}}}"#
    );

    write_session_file(&root_a, &day_key, &[line_a]);
    write_session_file(&root_b, &day_key, &[line_b]);

    let snapshot = scan_local_usage_core(2, None, &[root_a, root_b], false).expect("scan usage");
    let day = snapshot
        .days
        .iter()
        .find(|entry| entry.day == day_key)
        .expect("day entry");

    assert_eq!(day.input_tokens, 8);
    assert_eq!(day.output_tokens, 3);
    assert_eq!(snapshot.totals.last30_days_tokens, 11);
}

#[test]
fn resolve_sessions_roots_includes_workspace_overrides() {
    let mut workspaces = HashMap::new();
    let mut settings_a = WorkspaceSettings::default();
    settings_a.codex_home = Some(
        std::env::temp_dir()
            .join(format!("codex-home-a-{}", Uuid::new_v4()))
            .to_string_lossy()
            .to_string(),
    );
    let entry_a = WorkspaceEntry {
        id: "a".to_string(),
        name: "A".to_string(),
        path: "/tmp/project-a".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings: settings_a,
    };
    let mut settings_b = WorkspaceSettings::default();
    settings_b.codex_home = Some(
        std::env::temp_dir()
            .join(format!("codex-home-b-{}", Uuid::new_v4()))
            .to_string_lossy()
            .to_string(),
    );
    let entry_b = WorkspaceEntry {
        id: "b".to_string(),
        name: "B".to_string(),
        path: "/tmp/project-b".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings: settings_b,
    };
    workspaces.insert(entry_a.id.clone(), entry_a.clone());
    workspaces.insert(entry_b.id.clone(), entry_b.clone());

    let roots = resolve_sessions_roots(&workspaces, None);
    let codex_home_a = entry_a.settings.codex_home.clone().expect("codex home a");
    let codex_home_b = entry_b.settings.codex_home.clone().expect("codex home b");
    let expected_a = PathBuf::from(&codex_home_a).join("sessions");
    let expected_a_archived = PathBuf::from(&codex_home_a).join("archived_sessions");
    let expected_b = PathBuf::from(&codex_home_b).join("sessions");
    let expected_b_archived = PathBuf::from(&codex_home_b).join("archived_sessions");

    assert!(roots.iter().any(|root| root == &expected_a));
    assert!(roots.iter().any(|root| root == &expected_a_archived));
    assert!(roots.iter().any(|root| root == &expected_b));
    assert!(roots.iter().any(|root| root == &expected_b_archived));
}

#[test]
fn merge_codex_session_roots_keeps_override_and_default_roots() {
    let override_home = PathBuf::from("/tmp/codex-override");
    let default_home = PathBuf::from("/tmp/codex-default");

    let roots = merge_codex_session_roots(Some(override_home.clone()), Some(default_home.clone()));

    assert!(roots.contains(&override_home.join("sessions")));
    assert!(roots.contains(&override_home.join("archived_sessions")));
    assert!(roots.contains(&default_home.join("sessions")));
    assert!(roots.contains(&default_home.join("archived_sessions")));
}

#[test]
fn resolve_managed_codex_provider_session_roots_includes_sessions_and_archives() {
    let base = std::env::temp_dir().join(format!("ccgui-provider-homes-roots-{}", Uuid::new_v4()));
    let provider_homes_root = base.join("codex-provider-homes");
    let provider_a = provider_homes_root.join("provider-a");
    let provider_b = provider_homes_root.join("provider-b");
    fs::create_dir_all(provider_a.join("sessions")).expect("create provider a sessions");
    fs::create_dir_all(provider_b.join("archived_sessions")).expect("create provider b archives");
    fs::write(provider_homes_root.join("README.md"), "not a provider").expect("write marker");

    let (roots, diagnostics) =
        resolve_managed_codex_provider_session_roots_from_root(&provider_homes_root);

    assert!(diagnostics.is_empty());
    assert!(roots.contains(&provider_a.join("sessions")));
    assert!(roots.contains(&provider_a.join("archived_sessions")));
    assert!(roots.contains(&provider_b.join("sessions")));
    assert!(roots.contains(&provider_b.join("archived_sessions")));

    fs::remove_dir_all(base).ok();
}

#[test]
fn parse_codex_summary_from_provider_home_projects_provider_profile_id() {
    let base =
        std::env::temp_dir().join(format!("ccgui-provider-homes-summary-{}", Uuid::new_v4()));
    let provider_homes_root = base.join("codex-provider-homes");
    let provider_sessions_root = provider_homes_root.join("provider-a").join("sessions");
    let day_key = "2026-01-19";
    let session_path = write_named_session_file(
        &provider_sessions_root,
        day_key,
        "provider-session",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"provider-session","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:05.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}}"#
                .to_string(),
        ],
    );

    let summary = parse_codex_session_summary(&session_path, Some(Path::new("/tmp/project-alpha")))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.session_id, "provider-session");
    assert_eq!(summary.provider_profile_id.as_deref(), Some("provider-a"));
    assert_eq!(summary.provider_profile_source.as_deref(), Some("managed"));
    assert_eq!(summary.provider_availability.as_deref(), Some("unknown"));
    assert_eq!(
        summary.physical_path.as_deref(),
        Some(session_path.to_string_lossy().as_ref())
    );

    fs::remove_dir_all(base).ok();
}

#[test]
fn scan_codex_summaries_merges_disk_and_multiple_provider_homes_for_workspace() {
    let base = std::env::temp_dir().join(format!("ccgui-provider-homes-merge-{}", Uuid::new_v4()));
    let disk_root = base.join("disk").join("sessions");
    let provider_a_root = base
        .join("codex-provider-homes")
        .join("provider-a")
        .join("sessions");
    let provider_b_root = base
        .join("codex-provider-homes")
        .join("provider-b")
        .join("sessions");
    let day_key = "2026-01-19";
    write_named_session_file(
        &disk_root,
        day_key,
        "disk-session",
        &[r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"disk-session","cwd":"/tmp/project-alpha"}}"#.to_string()],
    );
    write_named_session_file(
        &provider_a_root,
        day_key,
        "provider-a-session",
        &[r#"{"timestamp":"2026-01-19T12:01:00.000Z","type":"session_meta","payload":{"id":"provider-a-session","cwd":"/tmp/project-alpha"}}"#.to_string()],
    );
    write_named_session_file(
        &provider_b_root,
        day_key,
        "provider-b-session",
        &[r#"{"timestamp":"2026-01-19T12:02:00.000Z","type":"session_meta","payload":{"id":"provider-b-session","cwd":"/tmp/project-alpha"}}"#.to_string()],
    );

    let summaries = scan_codex_session_summaries(
        Some(Path::new("/tmp/project-alpha")),
        &[disk_root, provider_a_root, provider_b_root],
    )
    .expect("scan summaries");
    let by_id = summaries
        .into_iter()
        .map(|summary| (summary.session_id.clone(), summary))
        .collect::<HashMap<_, _>>();

    assert!(by_id.contains_key("disk-session"));
    assert_eq!(
        by_id["provider-a-session"].provider_profile_id.as_deref(),
        Some("provider-a")
    );
    assert_eq!(
        by_id["provider-b-session"].provider_profile_id.as_deref(),
        Some("provider-b")
    );

    fs::remove_dir_all(base).ok();
}

#[test]
fn bounded_codex_scan_uses_recent_candidates_and_counts_unique_sessions() {
    assert_eq!(resolve_codex_candidate_scan_limit(2), 22);
    assert_eq!(resolve_codex_candidate_scan_limit(usize::MAX), usize::MAX);
    let base = std::env::temp_dir().join(format!("ccgui-codex-bounded-scan-{}", Uuid::new_v4()));
    let root = base.join("sessions");
    let day_key = "2026-01-19";
    let newest_a = write_named_session_file(
        &root,
        day_key,
        "rollout-a-new",
        &[r#"{"timestamp":"2026-01-19T12:03:00.000Z","type":"session_meta","payload":{"id":"session-a","cwd":"/tmp/project-alpha"}}"#.to_string()],
    );
    let duplicate_a = write_named_session_file(
        &root,
        day_key,
        "rollout-a-old",
        &[r#"{"timestamp":"2026-01-19T12:02:00.000Z","type":"session_meta","payload":{"id":"session-a","cwd":"/tmp/project-alpha"}}"#.to_string()],
    );
    let session_b = write_named_session_file(
        &root,
        day_key,
        "session-b",
        &[r#"{"timestamp":"2026-01-19T12:01:00.000Z","type":"session_meta","payload":{"id":"session-b","cwd":"/tmp/project-alpha"}}"#.to_string()],
    );
    let session_c = write_named_session_file(
        &root,
        day_key,
        "session-c",
        &[r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-c","cwd":"/tmp/project-alpha"}}"#.to_string()],
    );
    for (path, seconds) in [
        (&newest_a, 400),
        (&duplicate_a, 300),
        (&session_b, 200),
        (&session_c, 100),
    ] {
        File::open(path)
            .expect("open candidate")
            .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds))
            .expect("set candidate mtime");
    }

    let (summaries, scanned_file_count) = scan_codex_session_summaries_bounded_with_mode(
        Some(Path::new("/tmp/project-alpha")),
        std::slice::from_ref(&root),
        2,
        CodexSessionParseMode::ThreadPreview,
        None,
    )
    .expect("bounded scan summaries");
    let session_ids = summaries
        .into_iter()
        .map(|summary| summary.session_id)
        .collect::<HashSet<_>>();

    assert_eq!(
        session_ids,
        HashSet::from(["session-a".to_string(), "session-b".to_string()])
    );
    assert_eq!(
        scanned_file_count, 3,
        "duplicate must not consume the unique-session budget"
    );

    fs::remove_dir_all(base).ok();
}

#[test]
fn bounded_scan_expired_deadline_aborts_before_parsing_candidates() {
    // fix-codex-scan-deadline-abort：外层 timeout 只放弃 JoinHandle，扫描线程
    // 必须靠内层 deadline 真正停止读盘。expired deadline 应在打开任何候选文件
    // 前返回 Err；远期 deadline 不改变既有行为。
    let base = std::env::temp_dir().join(format!("ccgui-codex-deadline-{}", Uuid::new_v4()));
    let root = base.join("sessions");
    write_named_session_file(
        &root,
        "2026-01-19",
        "rollout-a",
        &[r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-a","cwd":"/tmp/project-alpha"}}"#.to_string()],
    );

    let expired = scan_codex_session_summaries_bounded_with_mode(
        Some(Path::new("/tmp/project-alpha")),
        std::slice::from_ref(&root),
        2,
        CodexSessionParseMode::ThreadPreview,
        Some(Instant::now() - StdDuration::from_millis(1)),
    )
    .expect_err("expired deadline must abort scan");
    assert_eq!(expired, CODEX_SCAN_DEADLINE_EXCEEDED);

    let (summaries, scanned_file_count) = scan_codex_session_summaries_bounded_with_mode(
        Some(Path::new("/tmp/project-alpha")),
        std::slice::from_ref(&root),
        2,
        CodexSessionParseMode::ThreadPreview,
        Some(Instant::now() + StdDuration::from_secs(60)),
    )
    .expect("future deadline keeps scan working");
    assert_eq!(scanned_file_count, 1);
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].session_id, "session-a");

    fs::remove_dir_all(base).ok();
}

#[test]
fn bounded_candidate_collection_does_not_starve_provider_home_roots() {
    // P0 回归：主 home sessions/archived 填满候选 buffer 后提前 break，
    // 靠后的 codex-provider-homes roots 永远扫不到，managed provider 会话
    // 重启后从侧栏消失。per-root 公平收集后，每个 root 的最新文件都必须
    // 进入全局 mtime 竞争。
    let base = std::env::temp_dir().join(format!("ccgui-codex-fair-collect-{}", Uuid::new_v4()));
    let disk_root = base.join("disk").join("sessions");
    let provider_root = base
        .join("codex-provider-homes")
        .join("provider-a")
        .join("sessions");
    let day_key = "2026-01-19";
    let mut disk_paths = Vec::new();
    for index in 0..6 {
        disk_paths.push(write_named_session_file(
            &disk_root,
            day_key,
            &format!("disk-session-{index}"),
            &[r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"disk","cwd":"/tmp/project-alpha"}}"#.to_string()],
        ));
    }
    let provider_newest = write_named_session_file(
        &provider_root,
        day_key,
        "provider-session-new",
        &[r#"{"timestamp":"2026-01-19T12:09:00.000Z","type":"session_meta","payload":{"id":"provider-new","cwd":"/tmp/project-alpha"}}"#.to_string()],
    );
    // 主 home 文件全部更旧；provider 文件最新。
    for (offset, path) in disk_paths.iter().enumerate() {
        File::open(path)
            .expect("open disk candidate")
            .set_modified(
                std::time::UNIX_EPOCH + std::time::Duration::from_secs(100 + offset as u64),
            )
            .expect("set disk mtime");
    }
    File::open(&provider_newest)
        .expect("open provider candidate")
        .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(10_000))
        .expect("set provider mtime");

    // cap=4 < 主 home 文件数（6）：旧实现会在第一个 root 填满后 break，
    // provider root 根本不会被遍历。
    let candidates = collect_codex_jsonl_candidates_recent_first(&[disk_root, provider_root], 4);
    let paths = candidates
        .iter()
        .map(|candidate| candidate.path.clone())
        .collect::<Vec<_>>();

    assert!(
        paths.contains(&provider_newest),
        "provider-home root must be collected even when earlier roots fill the cap: {paths:?}"
    );
    assert_eq!(candidates.len(), 4, "global truncate keeps the cap");
    assert_eq!(
        candidates.first().map(|candidate| candidate.path.as_path()),
        Some(provider_newest.as_path()),
        "global mtime sort keeps the newest file first"
    );

    fs::remove_dir_all(base).ok();
}

#[test]
fn full_codex_scan_merges_duplicate_evidence_before_truncation() {
    let base = std::env::temp_dir().join(format!("ccgui-codex-full-scan-{}", Uuid::new_v4()));
    let root = base.join("sessions");
    let newest = write_named_session_file(
        &root,
        "2026-01-19",
        "rollout-new",
        &[r#"{"timestamp":"2026-01-19T12:01:00.000Z","type":"session_meta","payload":{"id":"session-a","cwd":"/tmp/project-alpha"}}"#.to_string()],
    );
    let older_with_usage = write_named_session_file(
        &root,
        "2026-01-18",
        "rollout-old",
        &[
            r#"{"timestamp":"2026-01-18T12:00:00.000Z","type":"session_meta","payload":{"id":"session-a","cwd":"/tmp/project-alpha"}}"#.to_string(),
            r#"{"timestamp":"2026-01-18T12:00:01.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#.to_string(),
        ],
    );
    File::open(&newest)
        .expect("open newest candidate")
        .set_modified(UNIX_EPOCH + StdDuration::from_secs(200))
        .expect("set newest candidate mtime");
    File::open(&older_with_usage)
        .expect("open older candidate")
        .set_modified(UNIX_EPOCH + StdDuration::from_secs(100))
        .expect("set older candidate mtime");

    let (summaries, scanned_file_count) = scan_codex_session_summaries_bounded_with_mode(
        Some(Path::new("/tmp/project-alpha")),
        std::slice::from_ref(&root),
        1,
        CodexSessionParseMode::Full,
        None,
    )
    .expect("full scan summaries");

    assert_eq!(scanned_file_count, 2);
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].session_id, "session-a");
    assert_eq!(summaries[0].usage.total_tokens, 15);

    fs::remove_dir_all(base).ok();
}

#[test]
fn thread_preview_caps_jsonl_bytes_and_uses_file_mtime() {
    let root = make_temp_sessions_root();
    let oversized_early_event = format!(
        r#"{{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{{"type":"notice","blob":"{}"}}}}"#,
        "x".repeat(CODEX_THREAD_PREVIEW_MAX_BYTES as usize)
    );
    let path = write_named_session_file(
        &root,
        "2026-01-19",
        "preview-byte-budget",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"preview-session","cwd":"/tmp/project-alpha"}}"#.to_string(),
            r#"{"timestamp":"2026-01-19T12:00:00.500Z","type":"event_msg","payload":{"type":"user_message","message":"Preview title"}}"#.to_string(),
            oversized_early_event,
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#.to_string(),
        ],
    );
    let expected_mtime = UNIX_EPOCH + StdDuration::from_secs(777);
    File::open(&path)
        .expect("open preview candidate")
        .set_modified(expected_mtime)
        .expect("set preview mtime");

    let preview = parse_codex_session_summary_with_mode(
        &path,
        Some(Path::new("/tmp/project-alpha")),
        CodexSessionParseMode::ThreadPreview,
    )
    .expect("parse preview")
    .expect("preview summary");
    let full = parse_codex_session_summary(&path, Some(Path::new("/tmp/project-alpha")))
        .expect("parse full")
        .expect("full summary");

    assert_eq!(preview.summary.as_deref(), Some("Preview title"));
    assert_eq!(preview.timestamp, 777_000);
    assert_eq!(preview.usage.total_tokens, 0);
    assert_eq!(full.usage.total_tokens, 15);

    fs::remove_dir_all(root).ok();
}

#[test]
fn scan_codex_summaries_prefers_latest_valid_native_thread_name() {
    let base = std::env::temp_dir().join(format!("ccgui-codex-native-title-{}", Uuid::new_v4()));
    let codex_home = base.join("codex-home");
    let sessions_root = codex_home.join("sessions");
    let session_id = "native-title-session";
    write_named_session_file(
        &sessions_root,
        "2026-01-19",
        session_id,
        &[
            format!(
                r#"{{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{{"id":"{session_id}","cwd":"/tmp/project-alpha"}}}}"#
            ),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"First prompt fallback"}}"#
                .to_string(),
        ],
    );
    write_codex_session_index(
        &codex_home,
        &[
            "{not-json}".to_string(),
            serde_json::json!({
                "id": session_id,
                "thread_name": "Earlier native title",
                "updated_at": "2026-01-19T12:01:00Z"
            })
            .to_string(),
            serde_json::json!({
                "id": session_id,
                "thread_name": "Latest native title",
                "updated_at": "2026-01-19T12:02:00Z"
            })
            .to_string(),
            serde_json::json!({
                "id": session_id,
                "thread_name": "   ",
                "updated_at": "2026-01-19T12:03:00Z"
            })
            .to_string(),
        ],
    );

    let summaries = scan_codex_session_summaries(
        Some(Path::new("/tmp/project-alpha")),
        std::slice::from_ref(&sessions_root),
    )
    .expect("scan summaries");

    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].summary.as_deref(), Some("Latest native title"));
    assert_eq!(
        summaries[0].native_title.as_deref(),
        Some("Latest native title")
    );

    fs::remove_dir_all(base).ok();
}

#[test]
fn scan_codex_summaries_keep_native_thread_names_scoped_to_each_home() {
    let base = std::env::temp_dir().join(format!("ccgui-codex-title-homes-{}", Uuid::new_v4()));
    let home_a = base.join("home-a");
    let home_b = base.join("home-b");
    let root_a = home_a.join("sessions");
    let root_b = home_b.join("sessions");
    for (root, session_id, timestamp) in [
        (&root_a, "session-a", "2026-01-19T12:00:00.000Z"),
        (&root_b, "session-b", "2026-01-19T12:01:00.000Z"),
    ] {
        write_named_session_file(
            root,
            "2026-01-19",
            session_id,
            &[format!(
                r#"{{"timestamp":"{timestamp}","type":"session_meta","payload":{{"id":"{session_id}","cwd":"/tmp/project-alpha"}}}}"#
            )],
        );
    }
    write_codex_session_index(
        &home_a,
        &[
            serde_json::json!({"id": "session-a", "thread_name": "Home A title"}).to_string(),
            serde_json::json!({"id": "session-b", "thread_name": "Wrong title from A"}).to_string(),
        ],
    );
    write_codex_session_index(
        &home_b,
        &[
            serde_json::json!({"id": "session-a", "thread_name": "Wrong title from B"}).to_string(),
            serde_json::json!({"id": "session-b", "thread_name": "Home B title"}).to_string(),
        ],
    );

    let summaries =
        scan_codex_session_summaries(Some(Path::new("/tmp/project-alpha")), &[root_a, root_b])
            .expect("scan summaries");
    let by_id = summaries
        .into_iter()
        .map(|summary| (summary.session_id.clone(), summary))
        .collect::<HashMap<_, _>>();

    assert_eq!(by_id["session-a"].summary.as_deref(), Some("Home A title"));
    assert_eq!(by_id["session-b"].summary.as_deref(), Some("Home B title"));
    assert_eq!(
        by_id["session-a"].native_title.as_deref(),
        Some("Home A title")
    );
    assert_eq!(
        by_id["session-b"].native_title.as_deref(),
        Some("Home B title")
    );

    fs::remove_dir_all(base).ok();
}

#[test]
fn scan_codex_summaries_do_not_copy_native_title_across_homes_during_dedupe() {
    let base = std::env::temp_dir().join(format!("ccgui-codex-title-dedupe-{}", Uuid::new_v4()));
    let home_a = base.join("home-a");
    let home_b = base.join("home-b");
    let root_a = home_a.join("sessions");
    let root_b = home_b.join("sessions");
    let session_id = "shared-session";
    write_named_session_file(
        &root_a,
        "2026-01-19",
        session_id,
        &[
            format!(
                r#"{{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{{"id":"{session_id}","cwd":"/tmp/project-alpha"}}}}"#
            ),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"Older fallback"}}"#
                .to_string(),
        ],
    );
    write_named_session_file(
        &root_b,
        "2026-01-19",
        session_id,
        &[
            format!(
                r#"{{"timestamp":"2026-01-19T13:00:00.000Z","type":"session_meta","payload":{{"id":"{session_id}","cwd":"/tmp/project-alpha"}}}}"#
            ),
            r#"{"timestamp":"2026-01-19T13:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"Newer fallback"}}"#
                .to_string(),
        ],
    );
    write_codex_session_index(
        &home_a,
        &[serde_json::json!({"id": session_id, "thread_name": "Home A only"}).to_string()],
    );

    let summaries =
        scan_codex_session_summaries(Some(Path::new("/tmp/project-alpha")), &[root_a, root_b])
            .expect("scan summaries");

    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].summary.as_deref(), Some("Newer fallback"));
    assert_eq!(summaries[0].native_title, None);

    fs::remove_dir_all(base).ok();
}

#[test]
fn scan_codex_summaries_dedupes_physical_rollouts_by_canonical_id() {
    let base =
        std::env::temp_dir().join(format!("ccgui-codex-canonical-dedupe-{}", Uuid::new_v4()));
    let root = base.join("sessions");
    let day_key = "2026-01-19";
    write_named_session_file(
        &root,
        day_key,
        "rollout-child-copy-a",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"child-session","cwd":"/tmp/project-alpha","source":{"subagent":{"thread_spawn":{"parent_thread_id":"parent-session","agent_nickname":"Aristotle"}}}}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":2}}}}"#
                .to_string(),
        ],
    );
    write_named_session_file(
        &root,
        day_key,
        "rollout-child-copy-b",
        &[
            r#"{"timestamp":"2026-01-19T12:05:00.000Z","type":"session_meta","payload":{"id":"child-session","cwd":"/tmp/project-alpha","source":"cli"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:05:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"Inherited parent prompt"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:05:02.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":20,"cached_input_tokens":0,"output_tokens":3}}}}"#
                .to_string(),
        ],
    );

    let summaries = scan_codex_session_summaries(
        Some(Path::new("/tmp/project-alpha")),
        std::slice::from_ref(&root),
    )
    .expect("scan summaries");

    assert_eq!(summaries.len(), 1);
    let summary = &summaries[0];
    assert_eq!(summary.session_id, "child-session");
    assert_eq!(summary.parent_session_id.as_deref(), Some("parent-session"));
    assert_eq!(summary.summary.as_deref(), Some("Aristotle"));
    assert_eq!(summary.usage.input_tokens, 20);
    assert_eq!(summary.usage.output_tokens, 3);
    assert_eq!(
        summary.session_id_aliases,
        vec![
            "rollout-child-copy-a".to_string(),
            "rollout-child-copy-b".to_string(),
        ]
    );

    fs::remove_dir_all(base).ok();
}

#[test]
fn scan_codex_provider_home_summary_excludes_other_workspace() {
    let base = std::env::temp_dir().join(format!("ccgui-provider-homes-scope-{}", Uuid::new_v4()));
    let provider_root = base
        .join("codex-provider-homes")
        .join("provider-a")
        .join("sessions");
    let day_key = "2026-01-19";
    write_named_session_file(
        &provider_root,
        day_key,
        "other-workspace-session",
        &[r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"other-workspace-session","cwd":"/tmp/project-beta"}}"#.to_string()],
    );

    let summaries =
        scan_codex_session_summaries(Some(Path::new("/tmp/project-alpha")), &[provider_root])
            .expect("scan summaries");

    assert!(summaries.is_empty());

    fs::remove_dir_all(base).ok();
}

#[cfg(windows)]
#[test]
fn merge_codex_session_roots_dedupes_case_and_separator_variants() {
    let override_home = PathBuf::from(r"C:\Users\Chen\.codex");
    let default_home = PathBuf::from(r"c:/users/chen/.codex");

    let roots = merge_codex_session_roots(Some(override_home.clone()), Some(default_home));

    assert_eq!(roots.len(), 2);
    assert!(roots.contains(&override_home.join("sessions")));
    assert!(roots.contains(&override_home.join("archived_sessions")));
}

#[cfg(not(windows))]
#[test]
fn resolve_workspace_codex_home_for_path_matches_private_prefix_variant() {
    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some("/tmp/codex-home-private".to_string());
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
    let mut workspaces = HashMap::new();
    workspaces.insert(entry.id.clone(), entry);

    let resolved = resolve_workspace_codex_home_for_path(
        &workspaces,
        Some(Path::new("/private/tmp/project-alpha/src")),
    );

    assert_eq!(resolved, Some(PathBuf::from("/tmp/codex-home-private")));
}

#[cfg(windows)]
#[test]
fn resolve_workspace_codex_home_for_path_matches_unc_extended_variant() {
    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(r"C:\codex-home-unc".to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: r"\\SERVER\Share\project".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspaces = HashMap::new();
    workspaces.insert(entry.id.clone(), entry);

    let resolved = resolve_workspace_codex_home_for_path(
        &workspaces,
        Some(Path::new(r"\\?\UNC\server\share\project\src")),
    );

    assert_eq!(resolved, Some(PathBuf::from(r"C:\codex-home-unc")));
}

#[tokio::test]
async fn list_codex_session_summaries_for_workspace_does_not_clamp_to_200() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    for index in 0..230 {
        let session_id = format!("session-{index:03}");
        write_named_session_file(
            &sessions_root,
            day_key,
            &session_id,
            &[format!(
                r#"{{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{{"id":"{session_id}","cwd":"/tmp/project-alpha"}}}}"#
            )],
        );
    }

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

    let (_, sessions) =
        list_codex_session_summaries_for_workspace(&workspaces, "workspace-id", 230)
            .await
            .expect("list codex summaries");

    assert_eq!(sessions.len(), 230);
}

#[test]
fn load_codex_session_entries_reads_matching_workspace_session() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    write_named_session_file(
            &root,
            day_key,
            "session-alpha",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/project-alpha"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:05.000Z","type":"response_item","payload":{"type":"reasoning","id":"reason-1","summary":"Inspect","content":"Inspect workspace"}}"#
                    .to_string(),
            ],
        );

    let entries = load_codex_session_entries("session-alpha", workspace_path, &[root])
        .expect("load session entries");

    assert_eq!(entries.len(), 2);
    assert_eq!(
        entries[0]["type"],
        Value::String("session_meta".to_string())
    );
    assert_eq!(
        entries[1]["payload"]["type"],
        Value::String("reasoning".to_string())
    );
}

#[test]
fn load_codex_session_entries_matches_rollout_filename_by_session_meta_id() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    write_named_session_file(
            &root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-alpha",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:05.000Z","type":"response_item","payload":{"type":"reasoning","id":"reason-1","summary":"Inspect","content":"Inspect workspace"}}"#
                    .to_string(),
            ],
        );

    let entries = load_codex_session_entries("session-alpha", workspace_path, &[root])
        .expect("load session entries");

    assert_eq!(entries.len(), 2);
    assert_eq!(
        entries[0]["payload"]["id"],
        Value::String("session-alpha".to_string())
    );
    assert_eq!(
        entries[1]["payload"]["type"],
        Value::String("reasoning".to_string())
    );
}

#[test]
fn load_codex_session_entries_reads_nested_session_meta_cwd() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    write_named_session_file(
            &root,
            day_key,
            "session-alpha",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"sessionMeta":{"cwd":"/tmp/project-alpha"}}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:05.000Z","type":"response_item","payload":{"type":"reasoning","id":"reason-1","summary":"Inspect","content":"Inspect workspace"}}"#
                    .to_string(),
            ],
        );

    let entries = load_codex_session_entries("session-alpha", workspace_path, &[root])
        .expect("load session entries");

    assert_eq!(entries.len(), 2);
}

#[test]
fn load_codex_session_entries_rejects_ambiguous_unknown_candidates() {
    let sessions_root = make_temp_sessions_root();
    let archived_root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    write_named_session_file(
            &sessions_root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-alpha",
            &[r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha"}}"#
                .to_string()],
        );
    write_named_session_file(
            &archived_root,
            day_key,
            "rollout-2026-01-19T12-05-00-session-alpha",
            &[r#"{"timestamp":"2026-01-19T12:05:00.000Z","type":"session_meta","payload":{"id":"session-alpha"}}"#
                .to_string()],
        );

    let error = load_codex_session_entries(
        "session-alpha",
        workspace_path,
        &[sessions_root, archived_root],
    )
    .expect_err("ambiguous unknown candidates should fail");

    assert!(error.contains("ambiguous codex session file"));
}

#[path = "tests/session_mutation.rs"]
mod session_mutation;


#[test]
fn parse_codex_session_summary_extracts_source_provider_metadata() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
            &root,
            day_key,
            "session-source-meta",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/project-alpha","source":"custom","provider":"openai"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":4}}}}"#
                    .to_string(),
            ],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.source.as_deref(), Some("custom"));
    assert_eq!(summary.provider.as_deref(), Some("openai"));
}

#[test]
fn parse_codex_session_summary_reads_nested_session_meta_cwd() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
            &root,
            day_key,
            "session-nested-cwd",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"sessionMeta":{"cwd":"/tmp/project-alpha"},"source":"custom","provider":"openai"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":4}}}}"#
                    .to_string(),
            ],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.source.as_deref(), Some("custom"));
    assert_eq!(summary.provider.as_deref(), Some("openai"));
}

#[test]
fn parse_codex_session_summary_reads_root_session_meta_cwd() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
        &root,
        day_key,
        "session-root-meta-cwd",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","sessionMeta":{"cwd":"/tmp/project-alpha"},"payload":{"source":"custom","provider":"openai"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":4}}}}"#
                .to_string(),
        ],
    );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.source.as_deref(), Some("custom"));
    assert_eq!(summary.provider.as_deref(), Some("openai"));
}

#[test]
fn parse_codex_session_summary_uses_latest_activity_timestamp() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
            &root,
            day_key,
            "session-latest-timestamp",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/project-alpha","source":"custom","provider":"openai"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:05:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":4}}}}"#
                    .to_string(),
            ],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    let expected_timestamp = DateTime::parse_from_rfc3339("2026-01-19T12:05:00.000Z")
        .expect("latest timestamp")
        .timestamp_millis();
    assert_eq!(summary.timestamp, expected_timestamp);
}

#[test]
fn parse_codex_session_summary_prefers_session_meta_id_over_rollout_filename() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
            &root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-alpha",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha","source":"custom","provider":"openai"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":4}}}}"#
                    .to_string(),
            ],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.session_id, "session-alpha");
    assert_eq!(
        summary.session_id_aliases,
        vec!["rollout-2026-01-19T12-00-00-session-alpha".to_string()]
    );
}

#[test]
fn parse_codex_session_summary_preserves_subagent_parent_and_agent_title() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
        &root,
        day_key,
        "rollout-2026-01-19T12-00-00-child-session",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"child-session","cwd":"/tmp/project-alpha","source":{"subagent":{"thread_spawn":{"parent_thread_id":"parent-session","depth":1,"agent_path":"/root/geometry-audit","agent_nickname":"Aristotle"}}},"originator":"codex-tui"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"一张图里有一个大圆A，请分析。"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"session_meta","payload":{"id":"parent-session","cwd":"/tmp/project-alpha","source":"cli","originator":"codex-tui"}}"#
                .to_string(),
        ],
    );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");
    let serialized = serde_json::to_value(&summary).expect("serialize summary");

    assert_eq!(summary.session_id, "child-session");
    assert_eq!(serialized["parentSessionId"], "parent-session");
    assert_eq!(summary.summary.as_deref(), Some("Aristotle"));
}

#[test]
fn parse_codex_session_summary_reads_camel_case_subagent_path_title() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
        &root,
        day_key,
        "rollout-2026-01-19T12-00-00-child-session",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"child-session","cwd":"/tmp/project-alpha","source":{"subAgent":{"threadSpawn":{"parentThreadId":"parent-session","agentPath":"C:\\agents\\geometry-audit"}}},"originator":"codex-tui"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"userMessage","message":"这段继承的父会话提示不应成为子代理标题。"}}"#
                .to_string(),
        ],
    );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.session_id, "child-session");
    assert_eq!(summary.parent_session_id.as_deref(), Some("parent-session"));
    assert_eq!(summary.summary.as_deref(), Some("geometry-audit"));
}

#[test]
fn parse_codex_session_summary_reads_payload_level_thread_source_subagent() {
    let root = make_temp_sessions_root();
    let day_key = "2026-08-20";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
        &root,
        day_key,
        "rollout-2026-08-20T10-50-09-01a01d13-7328-7153-99f3-faf8693a30cb",
        &[
            r#"{"timestamp":"2026-08-20T02:50:09.337Z","type":"session_meta","payload":{"id":"01a01d13-7328-7153-99f3-faf8693a30cb","parent_thread_id":"01a01b3c-db39-7362-9505-3e3535f4b878","thread_source":"subagent","agent_nickname":"Socrates","cwd":"/tmp/project-alpha","originator":"codex-tui"}}"#
                .to_string(),
            r#"{"timestamp":"2026-08-20T02:50:10.000Z","type":"event_msg","payload":{"type":"user_message","message":"审计这条不变量。"}}"#
                .to_string(),
        ],
    );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.session_id, "01a01d13-7328-7153-99f3-faf8693a30cb");
    assert_eq!(
        summary.parent_session_id.as_deref(),
        Some("01a01b3c-db39-7362-9505-3e3535f4b878")
    );
    assert_eq!(summary.summary.as_deref(), Some("Socrates"));
}

#[test]
fn parse_codex_session_summary_falls_back_to_filename_when_session_meta_id_missing() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
            &root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-alpha",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/project-alpha","source":"custom","provider":"openai"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":4}}}}"#
                    .to_string(),
            ],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(
        summary.session_id,
        "rollout-2026-01-19T12-00-00-session-alpha"
    );
}

#[test]
fn parse_codex_session_summary_prefers_originator_over_vscode_source() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
            &root,
            day_key,
            "session-originator-meta",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/project-alpha","source":"vscode","originator":"ccgui","model_provider":"openai"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":4}}}}"#
                    .to_string(),
            ],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.source.as_deref(), Some("ccgui"));
    assert_eq!(summary.provider.as_deref(), Some("openai"));
}

#[test]
fn parse_codex_session_summary_normalizes_legacy_mossx_originator() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
        &root,
        day_key,
        "session-legacy-originator",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/project-alpha","source":"vscode","originator":"mossx","model_provider":"openai"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":4}}}}"#
                .to_string(),
        ],
    );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.source.as_deref(), Some("ccgui"));
    assert_eq!(summary.provider.as_deref(), Some("openai"));
}

#[test]
fn parse_codex_session_summary_keeps_metadata_only_sessions_for_size_enrichment() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
            &root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-alpha",
            &[r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha","source":"custom","provider":"openai"}}"#
                .to_string()],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.session_id, "session-alpha");
    assert_eq!(summary.source.as_deref(), Some("custom"));
    assert_eq!(summary.provider.as_deref(), Some("openai"));
    assert_eq!(summary.usage.total_tokens, 0);
    assert!(summary.file_size_bytes.unwrap_or(0) > 0);
}

#[test]
fn parse_codex_session_summary_extracts_response_item_user_summary() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
        &root,
        day_key,
        "rollout-2026-01-19T12-00-00-memory-helper",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-memory-helper","cwd":"/tmp/project-alpha","source":"cli","provider":"openai"}}"#
                .to_string(),
            r###"{"timestamp":"2026-01-19T12:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"## Memory Writing Agent: Phase 2 (Consolidation)\n\nConsolidate raw memories."}]}}"###
                .to_string(),
        ],
    );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.session_id, "session-memory-helper");
    assert!(summary
        .summary
        .as_deref()
        .unwrap_or_default()
        .starts_with("## Memory Writing Agent: Phase 2"));
}

#[test]
fn parse_codex_session_summary_prefers_event_msg_user_summary_over_response_item_user() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
        &root,
        day_key,
        "rollout-2026-01-19T12-03-00-event-user-priority",
        &[
            r#"{"timestamp":"2026-01-19T12:03:00.000Z","type":"session_meta","payload":{"id":"session-event-user-priority","cwd":"/tmp/project-alpha","source":"cli","provider":"openai"}}"#
                .to_string(),
            r###"{"timestamp":"2026-01-19T12:03:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"response_item injected wrapper"}]}}"###
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:03:02.000Z","type":"event_msg","payload":{"type":"user_message","message":"real user request"}}"#
                .to_string(),
        ],
    );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.session_id, "session-event-user-priority");
    assert_eq!(summary.summary.as_deref(), Some("real user request"));
}

#[test]
fn parse_codex_session_summary_skips_agents_md_bootstrap_title() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
        &root,
        day_key,
        "rollout-2026-01-19T12-04-00-agents-bootstrap",
        &[
            r#"{"timestamp":"2026-01-19T12:04:00.000Z","type":"session_meta","payload":{"id":"session-agents-bootstrap","cwd":"/tmp/project-alpha","source":"cli","provider":"openai"}}"#
                .to_string(),
            r###"{"timestamp":"2026-01-19T12:04:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"# AGENTS.md instructions for /Users/zhukunpeng/Desktop/CC GUI 项目/desktop-cc-gui\n\n<INSTRUCTIONS>\nproject rules\n</INSTRUCTIONS>"}}"###
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:04:02.000Z","type":"event_msg","payload":{"type":"user_message","message":"为什么我一点，展示的是标注页面？编辑功能呢？"}}"#
                .to_string(),
        ],
    );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.session_id, "session-agents-bootstrap");
    assert_eq!(
        summary.summary.as_deref(),
        Some("为什么我一点，展示的是标注页面？编辑功能呢？")
    );
}

#[test]
fn parse_codex_session_summary_skips_environment_context_then_keeps_mossx() {
    let root = make_temp_sessions_root();
    let day_key = "2026-08-07";
    let workspace_path = Path::new("S:\\AIWorker\\zen_proxy");
    let session_path = write_named_session_file(
        &root,
        day_key,
        "rollout-2026-08-07T13-18-00-019fdaa8-262e-7981-8572-ce0884b61784",
        &[
            r#"{"timestamp":"2026-08-07T05:18:00.000Z","type":"session_meta","payload":{"id":"019fdaa8-262e-7981-8572-ce0884b61784","cwd":"S:\\AIWorker\\zen_proxy","source":"vscode","originator":"codex-tui"}}"#
                .to_string(),
            r#"{"timestamp":"2026-08-07T05:18:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>\n  <cwd>S:\\AIWorker\\zen_proxy</cwd>\n</environment_context>"}]}}"#
                .to_string(),
            r#"{"timestamp":"2026-08-07T05:18:15.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"MOSSX_CONTEXT_PACKAGE:sha256:eb6589d935390f007135fd0d0826a8ecd0f533feac376e82518036c88affe030:sha256:dead\nMOSSX_SHARED_CONTEXT_V1\nsession:89d8becf-c13a-4cad-94e8-2815d4cb179a\nbinding:codex:default\n\nCurrent user request:\n继续"}]}}"#
                .to_string(),
        ],
    );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");
    assert_eq!(summary.session_id, "019fdaa8-262e-7981-8572-ce0884b61784");
    let title = summary.summary.as_deref().unwrap_or("");
    assert!(
        title.starts_with("MOSSX_CONTEXT_PACKAGE"),
        "env context must not become title: {title}"
    );
    assert!(!title.contains("environment_context"));
}

#[test]
fn parse_codex_session_summary_keeps_normal_agents_md_question() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
        &root,
        day_key,
        "rollout-2026-01-19T12-04-30-agents-question",
        &[
            r#"{"timestamp":"2026-01-19T12:04:30.000Z","type":"session_meta","payload":{"id":"session-agents-question","cwd":"/tmp/project-alpha","source":"cli","provider":"openai"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:04:31.000Z","type":"event_msg","payload":{"type":"user_message","message":"为什么侧边栏显示 #AGENTS.md xxx？"}}"#
                .to_string(),
        ],
    );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.session_id, "session-agents-question");
    assert_eq!(
        summary.summary.as_deref(),
        Some("为什么侧边栏显示 #AGENTS.md xxx？")
    );
}

#[test]
fn parse_codex_session_summary_extracts_string_content_user_summary() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
        &root,
        day_key,
        "rollout-2026-01-19T12-05-00-string-content",
        &[
            r#"{"timestamp":"2026-01-19T12:05:00.000Z","type":"session_meta","payload":{"id":"session-string-content","cwd":"/tmp/project-alpha","source":"cli","provider":"openai"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:05:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":"string content user prompt"}}"#
                .to_string(),
        ],
    );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.session_id, "session-string-content");
    assert_eq!(
        summary.summary.as_deref(),
        Some("string content user prompt")
    );
}

#[test]
fn count_apply_patch_changed_lines_counts_additions_and_deletions() {
    let patch = r#"*** Begin Patch
*** Update File: /tmp/demo.ts
@@
-oldLine
+newLine
+addedLine
*** End Patch
"#;

    assert_eq!(count_apply_patch_changed_lines(patch), 3);
}

#[test]
fn count_apply_patch_changed_lines_keeps_content_starting_with_triple_markers() {
    let patch = r#"*** Begin Patch
*** Update File: /tmp/demo.ts
@@
----removedLeadingDashes
-removedLine
++++addedLeadingPluses
+addedLine
*** End Patch
"#;

    assert_eq!(count_apply_patch_changed_lines(patch), 4);
}

#[test]
fn parse_changed_lines_from_git_diff_stat_output_extracts_insertions_and_deletions() {
    let output = r#"Command: /bin/zsh -lc 'git diff --stat'
Output:
 src/main.ts  | 7 +++++--
 src/app.tsx  | 3 ++-
 2 files changed, 8 insertions(+), 2 deletions(-)
"#;

    assert_eq!(
        parse_changed_lines_from_git_diff_stat_output(output),
        Some(10)
    );
}

#[test]
fn parse_changed_lines_from_git_diff_stat_output_falls_back_to_stat_columns_without_english_summary(
) {
    let output = r#"输出:
 src/main.ts  | 7 +++++--
 src/app.tsx  | 3 ++-
 2 个文件已更改，8 处插入(+)，2 处删除(-)
"#;

    assert_eq!(
        parse_changed_lines_from_git_diff_stat_output(output),
        Some(10)
    );
}

#[test]
fn is_successful_apply_patch_output_accepts_camel_case_exit_code_and_rejects_case_insensitive_failures(
) {
    let success = r#"{"metadata":{"exitCode":0},"output":"noop"}"#;
    let failed = "Verification Failed: context mismatch";

    assert!(is_successful_apply_patch_output(success));
    assert!(!is_successful_apply_patch_output(failed));
}

#[test]
fn is_successful_apply_patch_output_accepts_string_exit_code_and_nested_output_object() {
    let success = r#"{"metadata":{"exit_code":"0"},"output":{"summary":"ok"}}"#;
    assert!(is_successful_apply_patch_output(success));
}

#[test]
fn parse_codex_session_summary_counts_modified_lines_from_object_output() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let session_path = write_named_session_file(
            &root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-apply",
            &[
                r#"{"type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch","call_id":"call-1","input":"*** Begin Patch\n*** Update File: /tmp/demo.ts\n@@\n-old\n+new\n*** End Patch\n"}}"#.to_string(),
                r#"{"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"call-1","output":{"metadata":{"exit_code":"0"},"output":"ok"}}}"#.to_string(),
            ],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), None)
        .expect("parse codex summary")
        .expect("summary exists");
    assert_eq!(summary.modified_lines, 2);
}

#[test]
fn read_i64_accepts_numeric_string_values() {
    let value = serde_json::json!({
        "input_tokens": "42",
        "output_tokens": 7
    });
    let map = value.as_object().expect("object");

    assert_eq!(read_i64(map, &["input_tokens"]), 42);
    assert_eq!(read_i64(map, &["output_tokens"]), 7);
}

#[cfg(not(windows))]
#[test]
fn path_matches_workspace_handles_private_prefix_variants_on_macos() {
    let workspace_private = Path::new("/private/tmp/project-alpha");
    let workspace_plain = Path::new("/tmp/project-alpha");

    assert!(path_matches_workspace(
        "/tmp/project-alpha/src",
        workspace_private
    ));
    assert!(path_matches_workspace(
        "/private/tmp/project-alpha/src",
        workspace_plain
    ));
    assert!(!path_matches_workspace(
        "/tmp/project-alpha-other",
        workspace_private
    ));
}

#[cfg(not(windows))]
#[test]
fn path_matches_workspace_handles_root_workspace_path() {
    let workspace = Path::new("/");
    assert!(path_matches_workspace("/Users/chen/project", workspace));
    assert!(!path_matches_workspace("relative/path", workspace));
}

#[cfg(windows)]
#[test]
fn path_matches_workspace_handles_drive_case_and_separator_variants() {
    let workspace = Path::new("C:\\Users\\Chen\\project");
    assert!(path_matches_workspace("c:/users/chen/project", workspace));
    assert!(path_matches_workspace(
        "c:\\users\\chen\\project\\src",
        workspace
    ));
    assert!(path_matches_workspace(
        "\\\\?\\C:\\Users\\Chen\\project\\src",
        workspace
    ));
    assert!(!path_matches_workspace(
        "c:\\users\\chen\\project-other",
        workspace
    ));
}

#[cfg(windows)]
#[test]
fn path_matches_workspace_handles_unc_extended_prefix() {
    let workspace = Path::new("\\\\SERVER\\Share\\project");
    assert!(path_matches_workspace(
        "\\\\?\\UNC\\server\\share\\project\\src",
        workspace
    ));
    assert!(!path_matches_workspace(
        "\\\\?\\UNC\\server\\share\\project-other",
        workspace
    ));
}

#[test]
fn delete_codex_session_file_at_removes_file_and_is_idempotent() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let session_path = write_named_session_file(
        &sessions_root,
        "2026-08-24",
        "rollout-2026-08-24T10-00-00-session-beta",
        &["{}".to_string()],
    );

    // 第一次删除：文件被移除
    let deleted = delete_codex_session_file_at(&session_path).expect("delete");
    assert!(deleted);
    assert!(!session_path.exists());

    // 第二次删除：NotFound → Ok(false)（ALREADY_MISSING 幂等语义）
    let deleted = delete_codex_session_file_at(&session_path).expect("delete again");
    assert!(!deleted);
}

#[test]
fn locate_codex_session_file_fast_matches_filename_without_reading_content() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    // 目标文件：rollout 后缀内嵌 session id
    let target = write_named_session_file(
        &sessions_root,
        "2026-08-24",
        "rollout-2026-08-24T11-00-00-session-gamma",
        &["not-even-json".to_string()],
    );
    // 干扰文件：不同 session id
    write_named_session_file(
        &sessions_root,
        "2026-08-24",
        "rollout-2026-08-24T11-01-00-session-other",
        &["{}".to_string()],
    );

    let located = locate_codex_session_file_fast("session-gamma", &[sessions_root.clone()]);
    assert_eq!(located, Some(target));

    // 未命中返回 None（ghost / already-missing 判定依据）
    assert!(locate_codex_session_file_fast("session-missing", &[sessions_root.clone()]).is_none());
    // 非法输入防御
    assert!(locate_codex_session_file_fast("../escape", &[sessions_root]).is_none());
}
