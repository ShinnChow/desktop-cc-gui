## MODIFIED Requirements

### Requirement: Claude Compaction Lifecycle Event Mapping

The Claude runtime MUST map Claude CLI compaction lifecycle signals to existing thread compaction events so frontend can reuse current status flow. The compacted completion marker MUST be a dedicated `context-event` item (kind `context-event`, `eventType: "compacted"`) — never an assistant message — carrying `reason`, `tokensBefore`, `estimatedTokensAfter`, and `turnId`, deduped per turn id.

#### Scenario: map compacting signal

- **WHEN** Claude stream emits a `system` event with compacting status
- **THEN** runtime SHALL emit `thread/compacting` for the active Claude thread
- **AND** frontend compaction state handler SHALL be able to consume it without protocol changes

#### Scenario: map compact boundary signal to compacted completion

- **WHEN** Claude stream emits `compact_boundary`
- **THEN** runtime SHALL emit `thread/compacted` for the same Claude thread
- **AND** frontend SHALL append a deduped `context-event` marker item through the current reducer flow (MUST NOT append an assistant message)

### Requirement: Claude Prompt Overflow Compaction UI MUST Remain Explicit And Recoverable

Claude prompt-overflow auto-compaction MUST keep frontend state explicit, bounded, and recoverable so users do not perceive compaction as a frozen conversation.

#### Scenario: compacting event shows active compacting state

- **WHEN** frontend receives `thread/compacting` for a Claude thread
- **THEN** the thread MUST enter context compacting state promptly
- **AND** the message surface MUST be able to show a compacting indicator

#### Scenario: compacted event clears compacting state

- **WHEN** frontend receives `thread/compacted` for the same Claude thread
- **THEN** the thread MUST leave context compacting state
- **AND** it MUST append the deduped `context-event` marker item (standalone system row, reason-aware localized copy)

#### Scenario: compaction failure settles to stable error state

- **WHEN** frontend receives `thread/compactionFailed`
- **THEN** the thread MUST leave context compacting state
- **AND** the UI MUST surface a recoverable error instead of leaving a permanent processing or compacting indicator
