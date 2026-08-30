## ADDED Requirements

### Requirement: Pi Provider Failures MUST Produce Bounded Correlated Evidence

When Pi reports a foreground provider/runtime failure, the system MUST record a
bounded failure envelope before emitting the terminal error. The envelope MUST
distinguish provider/model identity when selected, runtime mode, failure
surface, normalized error category, and whether assistant or tool output
preceded the failure. It MUST NOT include prompts, credentials, endpoint URLs,
raw stderr, or tool payloads.

#### Scenario: foreground fetch failure is classified without secrets

- **WHEN** a Pi foreground turn reports `fetch failed`
- **THEN** the terminal error MUST remain visible and the conversation MUST
  remain recoverable
- **AND** diagnostics MUST record it as a foreground upstream-transport
  failure unless stronger typed evidence identifies another category
- **AND** diagnostics MUST exclude sensitive or unbounded payloads

#### Scenario: failure after tool activity remains a failure

- **WHEN** Pi emits a provider/runtime error after assistant output or a tool
  activity event
- **THEN** the terminal outcome MUST remain an error rather than be silently
  promoted to successful completion
- **AND** the envelope MUST indicate that prior output existed

#### Scenario: provider failure is never automatically replayed

- **WHEN** a Pi foreground provider/runtime failure occurs
- **THEN** the system MUST NOT automatically resend the prompt
- **AND** it MUST NOT run a token-refresh, provider switch, or connection retry
  unless a separate idempotency-safe recovery contract authorizes it
