## MODIFIED Requirements

### Requirement: Qoder UI SHALL use one parent entry and dual configuration tabs

The Vendor Settings area SHALL present one Qoder page with Global and CN tabs and exactly
one independently operable visible configuration panel. Global SHALL be selected by
default; a Qoder CN settings deep link SHALL select the CN tab. The system MUST NOT
register `qoderclicn` as a second top-level CLI engine.

#### Scenario: configuration tabs are independent

- **WHEN** the user edits a CN binary/path/PAT or launches CN login
- **THEN** only the CN configuration and command MUST change
- **AND** the Global binary/path/PAT and login state MUST remain unchanged

#### Scenario: switching configuration tabs only changes presentation

- **WHEN** the user switches the Qoder Vendor Settings page from Global to CN
- **THEN** the CN configuration panel MUST become visible without rendering Global
  controls in parallel
- **AND** the switch MUST NOT refresh an ACP catalog or change any existing thread
  binding

## ADDED Requirements

### Requirement: New Session menu SHALL present direct Qoder distribution entries

The New Session menu SHALL present Qoder as direct distribution entries — one
`Qoder Global` row and one `Qoder CN` row — in both the Shared CLI section and the
Native CLI section. Activating an entry MUST immediately create a Qoder thread bound to
that distribution. The menu MUST NOT insert a second-level distribution flyout (parent
entry with Global/CN children) on the Qoder create path. Both entries MUST map to the
single `qoder` engine identity for engine visibility gates: disabling the Qoder CLI in
CLI configuration management MUST hide both entries together. The Global entry MUST
reflect the reported `qoder` engine status; the CN entry MUST NOT be blocked by that
single status report. Selecting a distribution entry MUST carry that distribution's
provider profile binding into the created thread without touching the Vendor Settings
selection.

#### Scenario: user creates a CN Qoder session from a direct entry

- **WHEN** the user activates the `Qoder CN` entry in the New Session menu
- **THEN** the create action MUST carry the CN distribution binding
- **AND** no distribution selection flyout MUST open before creation
- **AND** the new thread MUST preserve that binding for future sends

#### Scenario: CN entry stays reachable when the single engine status is unavailable

- **WHEN** the reported `qoder` engine status is unavailable or stale
- **THEN** the `Qoder Global` entry MUST be disabled with the availability reason
- **AND** the `Qoder CN` entry MUST remain activatable
- **AND** creation failure MUST surface the existing error reporting instead of a
  silent no-op

#### Scenario: engine visibility gate hides both entries together

- **WHEN** the `qoder` engine is disabled via product policy or CLI configuration
  management
- **THEN** both `Qoder Global` and `Qoder CN` entries MUST disappear from the
  Shared CLI and Native CLI sections

### Requirement: Qoder create flow SHALL bound engine switch wait

A session-creation flow that binds a Qoder distribution MUST NOT wait indefinitely on
the `switch_engine` IPC. The wait MUST be bounded; when the bound is reached the flow
MUST keep the optimistic selection and complete without an error surface. Engine
detection on the create path MUST be per-engine and non-blocking. Late switch results
MUST be merged by the existing generation guard and MUST NOT roll back the
user-visible selection.

#### Scenario: hung switch engine IPC does not freeze the create flow

- **WHEN** the backend `switch_engine` IPC does not return within the bounded wait
- **THEN** the creation flow MUST proceed with the optimistic selection
- **AND** the creation progress dialog MUST close instead of hanging

#### Scenario: late switch result merges without rollback

- **WHEN** a switch result arrives after the bounded wait has already released the
  create flow
- **THEN** the generation guard MUST merge it in the background
- **AND** the flow MUST NOT roll back the optimistic selection or fight a late
  success
