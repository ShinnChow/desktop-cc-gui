# Design: fix-pi-terminal-identity-codex-runtime-noise

## Pi terminal identity

The renderer's equality guard is intentional: a same-thread old terminal must not clear a newer turn. Source tracing confirmed that the native Pi forwarder already supplies the accepted canonical turn id when converting `TurnCompleted` to `turn/completed`; the renderer has regression coverage for rejecting old terminals. No divergent native Pi transport id is currently reproducible, so an alias registry would add risk without fixing the reported `fetch failed` symptom.

- Native Pi send generates a canonical runtime turn id.
- Every forwarded start, delta, tool and terminal event for that execution MUST carry that id.
- If a future transport exposes another identifier, ingress may record an explicit alias bound to the canonical turn and execution scope. The renderer may accept only that scoped alias.
- An alias record is valid only for `{workspaceId, engine: "pi", threadId, canonicalTurnId, runtimeLeaseId?}` and is discarded when that execution becomes terminal or its runtime lease is replaced. A matching `threadId` alone is never alias evidence.
- Tests must prove both the canonical/alias positive path and the newer-turn negative path.
- If a terminal has no canonical-id match or verified alias, lifecycle code keeps the rejection. It records bounded scope/reason evidence and enters existing authoritative reconciliation; it must not force-settle, infer an id, or discard final text.

## Codex external child timeout

`codex_models_manager` is inside the external CLI. Product code cannot safely reap it. The controllable boundary is app-server lifecycle:

- Healthy existing `WorkspaceSession` uses its lightweight health probe and is reused.
- Automatic lifecycle/recovery must not issue `model/list` or unnecessarily replace a healthy server.
- Explicit model discovery remains allowed to issue `model/list`.
- Replacement is permitted only after the health probe or an explicit lifecycle owner establishes the existing session is unusable; model discovery itself is not that evidence.
- Existing stderr reason classification/aggregation remains intact. The diagnosis records that `codex_models_manager` is an external-process attribution, preserves the aggregate key and cap, and does not include raw stderr or attempt child control.

## Pi provider and background-task failure boundary

`fetch failed` is emitted by Pi as a provider/runtime error; it is not evidence
that a terminal identity guard caused the request to fail. A background task
ending with `exit 1` is likewise a task result, not proof that the foreground
provider request failed. Both may share an upstream dependency, but correlation
must be measured.

- At every Pi foreground terminal error and background-task terminal failure,
  record a bounded failure envelope: provider/model identifiers when selected,
  runtime mode (`rpc` or `print-json`), failure surface (`foreground` or
  `background-task`), normalized error category, task id when present, and
  whether prior assistant/tool output existed.
- The envelope MUST exclude prompt text, tokens, raw stderr, credentials,
  endpoint URLs, and tool payloads. It is for diagnostics, not user-visible
  retry policy.
- `fetch failed` is normalized as an upstream transport failure unless a
  stronger typed Pi error proves auth, model selection, local process exit, or
  user cancellation. It leaves the current conversation recoverable but never
  auto-replays a potentially side-effecting turn.
- The first repair is attribution and recovery correctness. A provider-specific
  retry / token refresh / connection change is permitted only after the matrix
  captures a reproducible, idempotency-safe failure signature.

## TDD order

1. Trace Pi producer-to-renderer turn-id transformation and retain canonical-terminal and stale-terminal regression coverage.
2. Add an explicit scoped alias only if a divergent transport identifier is reproduced.
3. Locate Codex session reuse test seam and retain health/reuse, explicit-discovery, and unhealthy-replacement coverage.
4. Add tests for foreground provider failure and background-task failure
   classification before recording the bounded envelope.
5. Implement only a proven churn/replacement or attribution defect; otherwise
   keep provider behavior unchanged and record external-boundary evidence.
