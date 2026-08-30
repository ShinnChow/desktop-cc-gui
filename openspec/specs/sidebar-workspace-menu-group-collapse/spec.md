# sidebar-workspace-menu-group-collapse Specification

## Purpose

Defines sidebar workspace menu group collapse defaults and accessible temporary toggle behavior.
## Requirements
### Requirement: Workspace Actions Group Defaults To Collapsed

The workspace menu groups (Shared CLI, Native CLI, workspace actions) MUST be
user-controllable collapsible sections. The collapsed state of each collapsible group
MUST persist locally across menu instances and app restarts; the default state for a
group with no persisted record MUST be expanded.

#### Scenario: Open workspace menu

- **WHEN** a user opens a workspace menu containing the new-session and
  workspace-actions groups
- **THEN** every group without a persisted collapsed record MUST render expanded
- **AND** each group with a persisted collapsed record MUST render collapsed with its
  action rows not rendered

#### Scenario: Reopen workspace menu

- **WHEN** a user collapses a group, closes the workspace menu, and opens it again
- **THEN** that group MUST return in its persisted collapsed state
- **AND** groups the user never collapsed MUST remain expanded

### Requirement: Workspace Actions Group Supports Accessible Temporary Toggle

Each collapsible group header (Shared CLI, Native CLI, workspace actions) MUST support
pointer and keyboard activation, MUST expose its current expanded state to assistive
technology, and MUST preserve all existing child action behavior while expanded. A
toggle MUST persist the new state before the menu re-renders so repeated toggles within
one menu instance stay consistent.

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
