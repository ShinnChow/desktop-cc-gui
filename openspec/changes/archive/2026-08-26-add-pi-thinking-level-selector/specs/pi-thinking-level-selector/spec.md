## ADDED Requirements

### Requirement: PI catalog MUST expose per-model thinking levels

PI model catalog entries MUST carry `supportedReasoningEfforts` derived from the model's reasoning capability, not a static seven-level list.

#### Scenario: reasoning model with thinkingLevelMap holes

- **WHEN** `get_available_models` returns a model with `reasoning: true` and `thinkingLevelMap` that sets `off`/`minimal`/`low`/`medium` to `null` and maps `high`/`max`
- **THEN** that catalog row's `supportedReasoningEfforts` MUST be `high` and `max` only
- **AND** `xhigh` MUST be omitted unless the map includes it

#### Scenario: non-reasoning model hides selector

- **WHEN** a PI model has `reasoning: false` or `--list-models` `thinking=no`
- **THEN** `supportedReasoningEfforts` MUST be empty
- **AND** the composer MUST NOT render a reasoning selector for that model

### Requirement: PI composer MUST follow the catalog allowlist

When the active composer engine is PI, reasoning controls MUST follow the selected model's catalog allowlist, matching dsh/qoder rather than Claude's fixed list.

#### Scenario: selector shows only allowed levels

- **WHEN** the user composes on PI with a model whose catalog allowlist is `off,minimal,low,medium,high`
- **THEN** the composer MUST show a reasoning selector
- **AND** the visible options MUST be exactly that allowlist (plus optional Default)
- **AND** `minimal` MUST be a first-class selectable effort

#### Scenario: default omits effort

- **WHEN** the user leaves PI reasoning on Default / null
- **THEN** send params MUST omit a non-empty `effort`
- **AND** the PI adapter MUST NOT call `set_thinking_level` for that turn

#### Scenario: selected effort reaches PI send

- **WHEN** the user selects an allowlisted PI thinking level and sends
- **THEN** `normalizeEngineScopedEffort("pi", effort)` MUST preserve `off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`
- **AND** `SendMessageParams.effort` MUST carry that level
- **AND** the resident path MUST `set_thinking_level` only if the level is in the current-model allowlist

### Requirement: PI thinking catalog MUST NOT run on session switch

Fetching PI thinking levels MUST use the existing engine-model catalog path and MUST NOT add IPC to thread click / `setActiveThreadId`.

#### Scenario: switching PI sessions does not probe thinking levels

- **WHEN** the user clicks a PI history session in the sidebar
- **THEN** the client MUST NOT spawn `pi --mode rpc` or call `get_engine_models` as a result of that click
- **AND** thinking-level catalog refresh remains limited to picker open, explicit refresh, or send-time missing catalog
