## MODIFIED Requirements

### Requirement: Shared Session Creation MUST Explicitly Select A Ready CLI

The Sidebar `Shared CLI` creation section MUST expose one entry per Shared-supported CLI
as a direct create action. Qoder MUST be presented as two explicit distribution entries
(`Qoder Global` / `Qoder CN`) instead of a single parent entry with a distribution
flyout. Selecting a ready entry MUST create the Shared Session with that entry's CLI
(or CLI distribution) as the initial target engine. The system MUST NOT infer the
initial engine or Model from the currently active Composer.

After the CLI is chosen, the system MUST resolve the **first Provider profile** in that
CLI's ordered provider catalog (same order as the Atomic target picker: local/default
sentinel first when present, then managed profiles) and MUST load that Provider's
**authoritative** model catalog before persisting `initialTarget`. The system MUST NOT
seed create-time models from a bare engine-wide model list or a non-force-refreshed
engine status cache. For Qoder, an explicitly selected distribution entry MUST pin that
distribution's fixed provider profile (`__qoder_global__` / `__qoder_cn__`); an absent
or unrecognized explicit id MUST fall back to the Global default.

#### Scenario: create Shared Session with a different active engine

- **WHEN** the active Composer targets Claude and the user selects Grok from the
  `Shared CLI` section
- **THEN** the new Shared Session MUST use Grok as its initial target engine
- **AND** it MUST NOT copy the Claude Composer Provider, Model, or Reasoning selection

#### Scenario: unavailable CLI remains diagnosable

- **WHEN** a Shared-supported CLI is not ready in the selected workspace
- **THEN** its entry MUST be disabled with the current availability reason
- **AND** the system MUST NOT create a partial Shared Session

#### Scenario: selected CLI defaults to first provider with authoritative catalog

- **WHEN** the user selects a ready CLI from the Shared creation section
- **THEN** the system MUST resolve that CLI's ordered Provider list and select the
  first profile
- **AND** MUST load models with provider-profile scope (local/default MUST use
  force-refresh so disk/settings are re-read; managed MUST use provider-scoped
  config/env)
- **AND** MUST pick the catalog default model when present, otherwise the first
  catalog row
- **AND** MUST persist a complete initial `ExecutionTarget` (engine, provider
  semantics, catalog entry id, runtime model, readable provider snapshot) before
  opening the session
- **AND** MUST NOT label the target as local/default unless the first profile is the
  local/default sentinel

#### Scenario: explicit Qoder distribution entry pins the shared create provider

- **WHEN** the user selects the `Qoder CN` entry in the `Shared CLI` section
- **THEN** the system MUST resolve the initial target with the `__qoder_cn__` fixed
  profile and load the CN distribution's authoritative catalog
- **AND** the persisted `ExecutionTarget` MUST keep the CN provider identity

#### Scenario: unrecognized explicit Qoder distribution falls back to Global

- **WHEN** no explicit distribution id is provided, or the id does not match a fixed
  Qoder distribution
- **THEN** the system MUST keep the Global default resolution unchanged

#### Scenario: Claude create syncs model mapping for the default provider

- **WHEN** the user creates a Shared Session with Claude and a resolved first Provider
  profile
- **THEN** the system MUST sync Claude ANTHROPIC model mapping for that profile before
  or as the session becomes visible
- **AND** mapping sync failure MUST NOT by itself abort session creation when the
  ExecutionTarget is already complete

#### Scenario: empty catalog fails closed

- **WHEN** the first Provider profile for the selected CLI has no usable model row
  after authoritative load
- **THEN** Shared Session creation MUST fail with an actionable error
- **AND** MUST NOT create a Shared Session directory, metadata row, Binding, or Turn
  fact
