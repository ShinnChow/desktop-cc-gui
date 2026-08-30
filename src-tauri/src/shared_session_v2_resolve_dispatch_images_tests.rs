use super::resolve_dispatch_images;
use crate::shared_event_log::canonical::types::{ArtifactRef, CanonicalUserInput};
use serde_json::Value;

fn artifact(locator: &str) -> ArtifactRef {
    ArtifactRef {
        artifact_id: "img-1".into(),
        media_type: "image/png".into(),
        size_bytes: Some(12),
        sha256: "a".repeat(64),
        locator: locator.into(),
        redaction: None,
        extra: Value::Object(Default::default()),
    }
}

#[test]
fn prefers_explicit_param_over_image_refs() {
    let input = CanonicalUserInput {
        text: Some("hi".into()),
        image_refs: Some(vec![artifact("/from/ref.png")]),
        attachment_refs: None,
        extra: Value::Object(Default::default()),
    };
    let resolved = resolve_dispatch_images(Some(vec!["/from/param.png".into()]), &input);
    assert_eq!(resolved, Some(vec!["/from/param.png".into()]));
}

#[test]
fn falls_back_to_durable_image_refs_when_param_empty() {
    let input = CanonicalUserInput {
        text: Some("这是什么".into()),
        image_refs: Some(vec![artifact("/Users/me/shot.png")]),
        attachment_refs: None,
        extra: Value::Object(Default::default()),
    };
    let resolved = resolve_dispatch_images(None, &input);
    assert_eq!(resolved, Some(vec!["/Users/me/shot.png".into()]));
    let resolved_empty = resolve_dispatch_images(Some(vec![]), &input);
    assert_eq!(resolved_empty, Some(vec!["/Users/me/shot.png".into()]));
}

#[test]
fn returns_none_when_no_images_anywhere() {
    let input = CanonicalUserInput {
        text: Some("no images".into()),
        image_refs: None,
        attachment_refs: None,
        extra: Value::Object(Default::default()),
    };
    assert_eq!(resolve_dispatch_images(None, &input), None);
}

