## ADDED Requirements

### Requirement: Pi Background-Task Failure MUST Remain Distinct From Foreground Failure

When a Pi background task reaches a failed terminal status, the system MUST
record it as a background-task failure rather than attributing it to the parent
foreground turn. Correlation with a foreground provider failure MAY be recorded
only through bounded shared context, never inferred from time proximity alone.

#### Scenario: exit 1 preserves task-local attribution

- **WHEN** a Pi background-task notification reports `exitCode: 1` or a failed
  task status
- **THEN** its task card MUST expose the failed terminal state
- **AND** diagnostics MUST record the task id, failure surface, runtime mode,
  and bounded status without marking the parent foreground turn failed solely
  because of the task result

#### Scenario: concurrent foreground and task failure remain independently queryable

- **WHEN** a foreground Pi turn reports `fetch failed` while a background task
  separately reports failure
- **THEN** diagnostics MUST preserve two distinct records with correlation
  fields available for later analysis
- **AND** the system MUST NOT infer either failure caused the other without
  stronger evidence
