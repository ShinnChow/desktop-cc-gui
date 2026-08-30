# sidebar-workspace-anchored-session-menu Specification

## ADDED Requirements

### Requirement: Workspace Session Menu MUST Anchor At The Trigger Point

The workspace session menu MUST render as a compact popover anchored at the click
coordinates (`workspaceMenuState.x/y` clamped to the viewport); it is opened from the
workspace row plus button / right-click, the worktree plus button, or the
session-folder plus entry. It MUST NOT render as a full-height drawer covering the
sidebar column, and its backdrop MUST stay transparent so the sidebar remains visible
and the user's pointer travel stays local to the project row.

#### Scenario: Open from a project row plus button

- **WHEN** a user clicks the「+」button on a workspace row located low in the sidebar
- **THEN** the menu MUST appear at the click coordinates (viewport-clamped)
- **AND** the menu width MUST stay compact (≤332px) with internal scrolling when content
  exceeds the max height
- **AND** no dimmed full-window scrim MUST cover the sidebar

#### Scenario: Open from session-folder plus entry

- **WHEN** a user clicks the folder-scoped「新建会话」entry inside a session folder
- **THEN** the same anchored popover MUST open with session groups only
- **AND** the created session MUST still be assigned to the target folder
  (`targetFolderId` 契约不变)

### Requirement: Session Group MUST Use Single Group With Shared CLI Flyout

The session menu MUST render one「新建会话」group: a `Shared CLI` lead row whose hover /
click opens an engine flyout submenu, followed by the Native CLI engine rows with their
provider flyouts. Submenus MUST flip to the left of the root menu when the root menu sits
near the right viewport edge, and MUST remain reachable via keyboard (ArrowRight). The
drawer-era flat two-group layout (Shared CLI / Native CLI as sibling sections) MUST NOT
return.

#### Scenario: Pick a shared engine

- **WHEN** a user hovers or clicks the `Shared CLI` lead row
- **THEN** the engine flyout lists the enabled shared engines including the direct
  `Qoder Global` / `Qoder CN` entries (no second-level distribution popup)
- **AND** activating an engine child creates the shared session with the remembered or
  explicit `providerProfileId` passthrough

#### Scenario: Submenu near right viewport edge

- **WHEN** the root menu is opened near the right edge of the window
- **THEN** the flyout submenu MUST open to the left of the root menu
  (viewport-clamped) instead of overflowing
