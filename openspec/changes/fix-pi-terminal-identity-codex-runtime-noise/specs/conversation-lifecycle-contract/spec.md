## ADDED Requirements

### Requirement: Pi Terminal Identity MUST Be Execution-Scoped

For Pi native realtime events, one execution MUST have one canonical renderer
`turnId`. A transport identifier different from that id MAY be accepted only as
an explicit alias bound to the same workspace, Pi engine, thread, canonical
turn, and runtime lease when available. Matching a `threadId` alone MUST NOT
create, infer, or validate an alias.

#### Scenario: proven Pi alias settles its canonical execution

- **WHEN** a Pi terminal event carries a transport id that has a live explicit
  alias record for the current workspace, engine, thread, canonical turn, and
  runtime lease when available
- **THEN** lifecycle settlement MUST use the canonical turn identity
- **AND** it MUST settle only that execution while preserving final assistant
  output

#### Scenario: unproven Pi terminal cannot settle by shared thread

- **WHEN** a Pi terminal event has a different `turnId` and no verified alias
- **THEN** the lifecycle guard MUST reject settlement
- **AND** it MUST NOT clear processing, replace `activeTurnId`, or force final
  text into a completed state merely because the thread matches

#### Scenario: newer Pi turn remains isolated from an old terminal

- **WHEN** a newer Pi execution owns the thread's `activeTurnId`
- **AND** an old terminal event arrives with either an unproven id or an alias
  scoped to the old execution
- **THEN** the older event MUST NOT clear or mutate the newer execution's
  lifecycle state

### Requirement: Rejected Pi Terminal MUST Request Scoped Reconciliation

The system MUST preserve an otherwise relevant Pi terminal rejection caused by
missing canonical-id or verified-alias evidence and use the existing
authoritative reconciliation path. It MUST NOT turn diagnostic evidence into
forced completion.

#### Scenario: rejected Pi terminal enters bounded reconciliation

- **WHEN** Pi terminal settlement is rejected due to an unproven identity
  mismatch
- **THEN** diagnostics MUST record the bounded workspace, engine, thread,
  terminal id, active id, runtime lease when available, and rejection reason
- **AND** reconciliation MUST use that scope without inferring an identity from
  the most recent foreground thread

#### Scenario: unknown reconciliation stays degraded

- **WHEN** scoped Pi reconciliation returns `unknown` or fails
- **THEN** the lifecycle MUST remain degraded and recoverable rather than be
  reported as completed
- **AND** any already received assistant text MUST remain durable and visible
