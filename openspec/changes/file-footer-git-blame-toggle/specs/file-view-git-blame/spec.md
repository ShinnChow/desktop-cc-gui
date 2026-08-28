## MODIFIED Requirements

### Requirement: File view Git Blame MUST be explicitly activated

The workspace text editor MUST keep Git Blame disabled by default and MUST load it only after an explicit action for the active file. The file view footer MUST expose a persistent Git Blame toggle as a first-class explicit action so the lazy contract stays discoverable; the toggle MUST NOT introduce any eager load path.

#### Scenario: opening a file does not request blame
- **WHEN** a user opens or activates a supported workspace text file without enabling Git Blame
- **THEN** the file view MUST NOT issue `get_git_file_blame`
- **AND** it MUST NOT mount a blame gutter or wait for blame before displaying the file

#### Scenario: user enables blame after editor mount
- **WHEN** the active editor is usable and the user enables Git Blame
- **THEN** the file view MUST request blame asynchronously for the active repository-relative file
- **AND** loading or failure MUST NOT disable editing, navigation, save, or file switching

#### Scenario: footer exposes the blame toggle for eligible files
- **WHEN** a supported workspace text file is open in edit mode and blame is eligible or already enabled
- **THEN** the file view footer MUST render a Git Blame toggle button to the left of the edit/preview mode toggle
- **AND** activating it MUST toggle blame through the existing explicit-action contract without any additional eager IPC

#### Scenario: footer toggle reflects blame state
- **WHEN** blame is disabled, enabled, loading, stale, or in error
- **THEN** the toggle MUST expose the same state wording as the file context menu entry through its accessible label and tooltip
- **AND** the enabled state MUST be exposed through `aria-pressed` so it does not rely on color alone

#### Scenario: footer toggle is unavailable for unsupported files
- **WHEN** the active file cannot be blamed and Git Blame is not enabled
- **THEN** the footer MUST NOT render the Git Blame toggle
- **AND** the existing file context menu entry MUST keep its current behavior
