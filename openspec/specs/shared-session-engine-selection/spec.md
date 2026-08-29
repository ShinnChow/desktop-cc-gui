# shared-session-engine-selection Specification

## Purpose

Defines the shared-session-engine-selection behavior contract, covering Shared Session Uses Explicit Manual Engine Selection.
## Requirements
### Requirement: Shared Target Picker MUST Refresh The Expanded Binding

Shared Session Target Picker 的 catalog action MUST 作用于用户当前展开的
`CLI + Provider Profile`，不得从 active thread 或 global engine selection 猜测目标。

#### Scenario: Refresh a non-active Provider

- **WHEN** Shared Session 当前绑定 Provider A
- **AND** 用户展开 Provider B 并执行 config reload 或 CLI discovery
- **THEN** 请求 MUST 携带 Provider B identity
- **AND** Provider B 模型框 MUST 使用刷新结果
- **AND** Provider A target snapshot MUST 保持不变

#### Scenario: Select discovered model

- **WHEN** Shared Picker 的 Provider B discovery 返回新模型
- **AND** 用户选择该模型
- **THEN** `selectedNextTarget` MUST 原子保存 Provider B identity、catalog entry id 与 runtime model
- **AND** send boundary MUST 继续使用冻结后的 runtime model

#### Scenario: One binding fails

- **WHEN** Shared Picker 中某一 binding 刷新失败
- **THEN** 其他 CLI/Profile catalog MUST 保持可用
- **AND** 整个 Shared Picker MUST NOT 被清空或关闭

### Requirement: Shared Session Uses Explicit Manual Engine Selection

Within a `shared session`, the system MUST let the user explicitly choose the execution target
before sending a turn. The selector MUST be a four-level target picker
(CLI → Provider → Model → Reasoning); the engine-only selector is superseded. Provider and
model items MUST preserve Provider Profile scope instead of inferring the target from model id
alone. The picker MUST be locked whenever the shared session composer is in any non-idle state.
Claude Code、Codex CLI、Kimi CLI、Grok CLI 与 OpenCode CLI MUST be selectable Shared
targets；registered engines outside this set MUST remain unavailable.

#### Scenario: shared composer exposes five supported CLIs

- **WHEN** the user focuses the composer inside a `shared session`
- **THEN** the four-level picker MUST enable Claude Code、Codex CLI、Kimi CLI、Grok CLI
  and OpenCode CLI
- **AND** each enabled CLI MUST expose its Provider-scoped Model catalog

#### Scenario: provider profile scopes its model catalog

- **WHEN** the user opens a Provider Profile inside the shared target picker
- **THEN** the system MUST show models resolved for that exact Engine and Provider Profile
- **AND** selecting a model MUST atomically preserve the Engine, Provider Profile, and Model identity
- **AND** an equal model id in another Provider Profile MUST NOT change or satisfy the selection

#### Scenario: unavailable engine remains explainable

- **WHEN** a registered CLI is not included in the supported Shared target set
- **THEN** the picker MUST keep the CLI unavailable
- **AND** MUST expose a human-readable reason rather than route through it

#### Scenario: picker update is metadata-only before send

- **WHEN** the user changes the shared-session target picker but does not submit a message yet
- **THEN** the system MUST update only the selected next target state for that shared session
- **AND** the system MUST NOT dispatch a turn, create a binding, or start an extra user-visible native conversation solely due to picker change

#### Scenario: submitted turn uses the user-selected target

- **WHEN** the user submits a message from a `shared session`
- **THEN** the system MUST dispatch that turn to the full target currently selected by the user
- **AND** the dispatch result MUST remain attributable to that selected target snapshot

#### Scenario: picker locks outside idle state

- **WHEN** the shared session composer is in any state other than `idle`
- **THEN** the target picker MUST be locked against changes
- **AND** the system MUST NOT apply a new target selection to the in-flight turn

#### Scenario: unsupported engines stay unavailable in shared session

- **WHEN** the user focuses the composer inside a `shared session`
- **THEN** engines outside Claude、Codex、Kimi、Grok and OpenCode MUST remain unavailable
- **AND** the system MUST NOT route a shared-session turn through an unsupported engine

### Requirement: Shared Session Engine Selection Is Sticky Until User Changes It

The currently selected execution engine in a `shared session` MUST remain active for subsequent turns until the user explicitly changes it.

#### Scenario: consecutive turns reuse prior engine selection

- **WHEN** the user sends a turn in a `shared session` and then sends another turn without changing the selector
- **THEN** the system MUST reuse the same execution engine for the later turn
- **AND** the system MUST NOT require the user to re-select an engine before every message

#### Scenario: changing selector updates future turns only

- **WHEN** the user changes the selected engine before sending the next message
- **THEN** the next turn MUST use the newly selected engine
- **AND** previously completed turns MUST keep their original engine attribution

#### Scenario: switching back to previous engine remains reversible

- **WHEN** the user switches from `Claude` to `Codex` and later switches back to `Claude` in the same shared session
- **THEN** each subsequent turn MUST execute on the latest selector value at send time
- **AND** the system MUST keep the selector reversible without locking the session to a prior engine

### Requirement: Each Shared Turn Uses Exactly One Engine

In V1, every user turn inside a `shared session` MUST execute on exactly one engine from start to terminal outcome.

#### Scenario: one submitted turn is not fanned out to multiple engines

- **WHEN** the user submits one message in a `shared session`
- **THEN** the system MUST dispatch that turn to exactly one engine
- **AND** the system MUST NOT fan out the same turn to multiple engines in parallel

#### Scenario: in-progress turn does not hand off to another engine

- **WHEN** a `shared session` turn is already running on a selected engine
- **THEN** the system MUST keep that turn bound to the same engine until terminal completion or failure
- **AND** the system MUST NOT hand off the remaining work to another engine mid-turn

### Requirement: Shared Session MUST NOT Auto-Route Or Silently Fallback

In V1, `shared session` dispatch MUST remain user-controlled and MUST NOT silently change the selected engine because of heuristics, availability checks, or runtime failures.

#### Scenario: system does not auto-route based on prompt content

- **WHEN** the user submits a turn in a `shared session`
- **THEN** the system MUST use the user-selected engine rather than auto-routing based on message content or task category
- **AND** the system MUST NOT replace manual choice with a heuristic engine decision

#### Scenario: selected engine failure does not trigger silent reroute

- **WHEN** the selected engine is unavailable or the turn fails during execution
- **THEN** the system MUST surface the error or recoverable failure state for that selected engine
- **AND** the system MUST NOT silently reroute the same turn to another engine

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

### Requirement: Opening An Existing Shared Session MUST Restore Last Selected Target

When the user opens or re-activates an existing Shared Session, the Composer next-target picker MUST restore the durable last `selectedTarget` / in-memory `selectedNextTarget` for that session. Create-time default Provider resolution MUST NOT run on open and MUST NOT overwrite a previously persisted complete target.

#### Scenario: reopen restores last provider and model

- **WHEN** a Shared Session was last used with a non-default Provider or Model
- **AND** the user later re-opens that session
- **THEN** the Atomic picker closed state and `selectedNextTarget` MUST show that last Provider and Model
- **AND** MUST NOT reset to the create-time first-provider default

#### Scenario: incomplete legacy target stays fail-closed on open

- **WHEN** a legacy Shared Session hydrates without a complete next target
- **THEN** the picker MUST remain unselected / incomplete rather than inventing a create-time default silently for send
- **AND** V2 send MUST continue to reject incomplete targets

