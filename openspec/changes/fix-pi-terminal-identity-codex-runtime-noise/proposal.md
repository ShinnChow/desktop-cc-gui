# Change: fix-pi-terminal-identity-codex-runtime-noise

## Why

2026-08-29 diagnostics captured two reliability signals that need to be
separated and verified end-to-end:

1. The reported Pi symptom initially raised a `turnId`-correlation concern. Source tracing now shows that native Pi forwarding already injects the send receipt's canonical `turnId` into `turn/completed`, while the renderer already rejects an older terminal against a newer active turn. Therefore this change preserves that contract with regression evidence; it does not add an alias state machine without a reproducible divergent transport id.
2. Multiple `codex-model-refresh-child-exit-timeout` aggregates appeared across workspaces. The captured process name indicates the external Codex CLI's internal `codex_models_manager`, rather than a child owned by this repository. This attribution remains trace evidence to preserve, not a license to manage that child. The controllable risk is unnecessary app-server replacement or implicit catalog refresh multiplying upstream work.
3. Pi with `openai-codex` can report `fetch failed` for the foreground turn, while Kimi / GLM can keep their foreground turn alive but still lose background tasks. These are separate provider-runtime signals; the application currently lacks a safe, correlated failure record to distinguish upstream transport/auth failure from background-task execution failure.

## What Changes

- Preserve the Pi ingress contract: one native execution has one canonical renderer `turnId`; a distinct transport id may be accepted only with explicit scoped alias evidence, never inferred from `threadId`.
- Retain regression coverage for canonical Pi terminal correlation and the existing rejection of an unproven old terminal when a newer turn owns the thread.
- Trace and test Codex `WorkspaceSession` reuse behavior: health checks MUST NOT issue `model/list` or replace healthy app-server sessions; explicit catalog discovery remains a separate path.
- Keep external Codex stderr classification, aggregation, and daily cap. Do not kill/reap, suppress, or misrepresent the external CLI child timeout.
- Define the degraded path explicitly: an unproven Pi terminal remains non-settling, records scoped rejection evidence, and requests authoritative reconciliation; it must never borrow identity from the current thread.
- Add a Pi Provider Failure Matrix across `openai-codex`, Kimi, and GLM: foreground turn vs background task, transport/auth/error category, runtime mode, and recovery outcome. Record bounded evidence only; no automatic retry of a turn that may already have invoked tools.

## Non-Goals

- Do not force-settle Pi terminal events merely because they share a thread.
- Do not control or patch Codex CLI internal child processes.
- Do not disable Codex model discovery or hide diagnostic evidence.
- Do not claim that eliminating app-server churn eliminates external Codex CLI child timeouts; that relationship must be measured from bounded diagnostics.
- Do not automatically replay a Pi prompt or background task after `fetch failed`; retries can duplicate edits, commands, or delegated work.

## Capabilities

### Modified Capabilities

- `conversation-lifecycle-contract`
- `engine-runtime-contract`
- `pi-rpc-session-runtime`
- `pi-background-task-experience`

## Acceptance

1. Proven Pi canonical ids or aliases settle exactly one foreground execution and preserve final assistant output. An alias is valid only within its workspace, engine, thread, and runtime execution scope.
2. An unproven Pi mismatch remains rejected, cannot clear a newer turn, and uses the existing scoped reconciliation path rather than forced completion.
3. A healthy Codex app-server reuse path performs its health probe only: no `model/list`, replacement, or spawn. Explicit catalog discovery remains available and separately test-covered.
4. External `codex_models_manager` timeout evidence retains its external attribution, aggregate key, and daily cap; diagnostics contain no child-control action or unbounded stderr payload.
5. All new cases start red, turn green, and affected Rust/TypeScript checks pass.
6. A Pi provider failure record distinguishes foreground `fetch failed` from background-task `exit 1` without logging tokens, prompts, raw stderr, or endpoint secrets.
