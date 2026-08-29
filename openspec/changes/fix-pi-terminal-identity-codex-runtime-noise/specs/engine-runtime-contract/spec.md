## ADDED Requirements

### Requirement: Healthy Codex Runtime Reuse MUST Not Trigger Catalog Work

A healthy Codex `WorkspaceSession` reuse path MUST use its lightweight health
probe only. It MUST NOT issue `model/list`, replace the app-server session, or
spawn a replacement runtime. Explicit catalog discovery is a separate,
user- or catalog-owner-initiated path and MAY issue `model/list`.

#### Scenario: healthy reuse remains probe-only

- **WHEN** a caller acquires an existing healthy Codex `WorkspaceSession` for
  normal runtime reuse
- **THEN** the runtime MUST perform only its health probe
- **AND** it MUST NOT send `model/list`, replace the session, or spawn another
  app-server process

#### Scenario: explicit discovery stays separate from health reuse

- **WHEN** an explicit Codex catalog discovery operation is requested
- **THEN** it MAY issue `model/list` through the catalog path
- **AND** a successful catalog request MUST NOT by itself be treated as
  evidence that a healthy runtime needs replacement

#### Scenario: unhealthy runtime keeps lifecycle ownership

- **WHEN** the health probe or an explicit lifecycle owner establishes that a
  Codex runtime is unusable
- **THEN** the existing bounded replacement or recovery path MAY run
- **AND** the decision MUST remain distinguishable from catalog discovery in
  diagnostics and tests

### Requirement: External Codex Child Timeout Diagnostics MUST Preserve Boundary

Timeouts attributed to the external Codex CLI's `codex_models_manager` MUST be
classified as external-process evidence. Product diagnostics MUST preserve a
bounded aggregate key and daily cap, and MUST NOT attempt to kill, reap, or
otherwise control that child process.

#### Scenario: external child timeout remains bounded and attributable

- **WHEN** stderr classification recognizes a `codex_models_manager` child
  timeout
- **THEN** diagnostics MUST identify the external Codex CLI attribution and
  preserve the bounded aggregate key and daily cap
- **AND** they MUST NOT include unbounded raw stderr payloads or claim the
  product owns the child

#### Scenario: external timeout does not justify healthy replacement

- **WHEN** external child-timeout evidence is received while the app-server
  session health probe succeeds
- **THEN** the evidence MUST NOT by itself replace or spawn a new healthy
  `WorkspaceSession`
- **AND** the aggregate MUST remain available for later correlation with
  measured lifecycle churn
