use super::validate_shared_session_workspace_owner;

#[test]
fn workspace_owner_requires_exact_session_and_workspace_identity() {
    assert!(validate_shared_session_workspace_owner(
        "session-1",
        "workspace-a",
        "session-1",
        "workspace-a",
    )
    .is_ok());
    assert!(validate_shared_session_workspace_owner(
        "session-1",
        "workspace-a",
        "session-1",
        "workspace-b",
    )
    .expect_err("cross-workspace owner must fail closed")
    .contains("shared-session-owner-mismatch"));
    assert!(validate_shared_session_workspace_owner(
        "session-2",
        "workspace-a",
        "session-1",
        "workspace-a",
    )
    .expect_err("cross-session owner must fail closed")
    .contains("shared-session-owner-mismatch"));
}

