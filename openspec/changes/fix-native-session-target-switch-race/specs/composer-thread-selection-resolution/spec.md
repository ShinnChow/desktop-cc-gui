# composer-thread-selection-resolution Delta

## ADDED Requirements

### Requirement: Active Native Composer target MUST follow thread identity synchronously

When selecting a recognized native CLI thread, Composer model/effort projection MUST use the target thread engine and its thread-scoped selection during the identity commit. It MUST NOT wait for deferred chrome/global engine state, and MUST NOT display a prior engine catalog default as the target thread selection.

#### Scenario: streaming Kimi to PI switch

- **GIVEN** global chrome engine is still `kimi` while a streaming update delays its transition
- **WHEN** the user selects a `pi:` native thread whose ledger target is `openai-codex/gpt-5.6-terra`
- **THEN** Composer MUST project the PI target immediately
- **AND** it MUST NOT display `kimi-coding/k3` solely because Kimi is the stale global engine

### Requirement: Native resolver MUST be thread-scoped at send boundary

Native Composer selection resolver snapshots MUST contain their owning `threadId` and a revision. A native send MUST consume a resolver snapshot only when it belongs to the requested thread; mismatch MUST NOT send its model, provider profile, or effort.

#### Scenario: immediate send after rapid switch

- **GIVEN** resolver snapshot A belongs to native thread A
- **WHEN** active/requested native thread changes to B and the user sends before deferred UI work completes
- **THEN** thread B MUST NOT use snapshot A
- **AND** the resulting target MUST be resolved from thread B's own selection/fallback
