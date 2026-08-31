use super::*;
use crate::shared_event_log::{open, Fidelity, OpenOutcome};

#[test]
fn legacy_snapshot_import_is_fingerprinted_and_idempotent() {
    let root = std::env::temp_dir().join(format!(
        "mossx-shared-legacy-import-{}-{}",
        std::process::id(),
        Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let writer = match open(&root.join("events.db")).expect("open store") {
        OpenOutcome::Ready(writer) => writer,
        OpenOutcome::ReadOnlyRecovery { reason, .. } => {
            panic!("unexpected recovery store: {reason}")
        }
    };
    let source_path = root.join("log.jsonl");
    let items = vec![
        json!({
            "id": "legacy-user-1",
            "kind": "message",
            "role": "user",
            "text": "legacy question",
            "turnId": "legacy-turn-1"
        }),
        json!({
            "id": "legacy-assistant-1",
            "kind": "message",
            "role": "assistant",
            "text": "legacy answer",
            "turnId": "legacy-turn-1",
            "isFinal": true
        }),
    ];

    for _ in 0..2 {
        import_legacy_snapshot_items(
            &writer,
            "legacy-session",
            &source_path,
            &items,
            EngineType::Claude,
            42,
        )
        .expect("import snapshot");
    }

    let events = writer
        .events_for_session("legacy-session")
        .expect("legacy events");
    assert_eq!(events.len(), 2);
    assert!(events
        .iter()
        .all(|event| event.fidelity == Fidelity::PresentationOnly));
    let marker = writer
        .legacy_import("legacy-session")
        .expect("read marker")
        .expect("marker");
    assert_eq!(marker.status, "completed");
    assert!(marker
        .imported_through_marker
        .as_deref()
        .is_some_and(|value| value.starts_with("snapshot-items:2:sha256:")));

    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

