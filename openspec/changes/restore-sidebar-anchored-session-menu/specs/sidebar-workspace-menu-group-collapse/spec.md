# sidebar-workspace-menu-group-collapse 变更（restore-sidebar-anchored-session-menu）

## MODIFIED Requirements

### Requirement: Workspace Actions Group Defaults To Collapsed

The workspace menu（贴点小弹窗形态）MUST render session creation as a single
non-collapsible `new-session` group; the `workspace actions` group MUST remain a
user-controllable collapsible section. The collapsed state of each collapsible group
MUST persist locally across menu instances and app restarts; the default state for a
group with no persisted record MUST be expanded. The drawer-era Shared CLI / Native CLI
collapsible sections are removed with the drawer shell.

#### Scenario: Open workspace menu

- **WHEN** a user opens a workspace menu containing the `new-session` and
  `workspace-actions` groups
- **THEN** the single `new-session` group MUST render its action rows directly
  without a collapse toggle
- **AND** the `workspace-actions` group without a persisted collapsed record MUST render
  expanded
- **AND** a group with a persisted collapsed record MUST render collapsed with its
  action rows not rendered

#### Scenario: Reopen workspace menu

- **WHEN** a user collapses the `workspace-actions` group, closes the workspace menu,
  and opens it again
- **THEN** that group MUST return in its persisted collapsed state
- **AND** groups the user never collapsed MUST remain expanded

### Requirement: Workspace Actions Group Supports Accessible Temporary Toggle

Each collapsible group header (`workspace actions`) MUST support pointer and keyboard
activation, MUST expose its current expanded state to assistive technology, and MUST
preserve all existing child action behavior while expanded. A toggle MUST persist the
new state before the menu re-renders so repeated toggles within one menu instance stay
consistent.

#### Scenario: Expand a collapsed group

- **WHEN** a user activates a collapsed group header
- **THEN** the header reports an expanded state
- **AND** all configured action rows of that group become available

#### Scenario: Collapse an expanded group

- **WHEN** a user activates an expanded group header
- **THEN** the header reports a collapsed state
- **AND** its action rows are removed from the rendered menu

#### Scenario: Invoke an existing action after expansion

- **WHEN** a user expands a group and activates an existing action or pin control
- **THEN** the pre-existing action or pin handler runs with unchanged semantics
