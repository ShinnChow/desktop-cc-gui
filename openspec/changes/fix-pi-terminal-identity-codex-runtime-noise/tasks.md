# Tasks: fix-pi-terminal-identity-codex-runtime-noise

## 1. Pi identity TDD

- [x] 1.1 Trace native Pi `turnId` from send receipt through app-server event payload and renderer ingress. Evidence: `commands.rs` passes the accepted id as `turn_id_context`; `events.rs` injects it into `turn/completed`.
- [x] 1.2 Reject an alias registry as unnecessary for the currently traceable native Pi path. A future alias is permitted only after a reproducible divergent transport id, with the documented workspace/engine/thread/turn/runtime-lease scope.
- [x] 1.3 Retain regression coverage for canonical terminal mapping and the newer-turn race; rejected events remain non-settling and enter existing scoped reconciliation.
- [x] 1.4 Preserve canonical id propagation at the producer boundary, including final text and existing terminal fences; no extra alias implementation is warranted.

## 2. Codex lifecycle TDD

- [x] 2.1 Locate `WorkspaceSession` reuse/health and explicit `model/list` test seams.
- [x] 2.2 Retain tests: health probe uses `collaborationMode/list`, explicit discovery uses `model/list`, and unhealthy reuse enters the existing stop/replacement path.
- [x] 2.3 Confirm no product code owns or controls a `codex_models_manager` child. The captured process name remains external CLI evidence; this change neither aggregates raw stderr nor changes child-control behavior.
- [x] 2.4 No trace-proven lifecycle churn defect exists in the current source: healthy reuse probes only and returns without replacement. Retain the external boundary instead of adding churn logic.

## 3. Validation

- [x] 3.1 Run targeted TypeScript and Rust tests; Rust format check only modified files.
- [x] 3.2 Run typecheck and applicable daemon/native check.
- [x] 3.3 Independently review turn-isolation, runtime churn, and external-error boundaries.
- [x] 3.4 Replace non-reproducible live-provider testing with an automated evidence matrix: canonical Pi terminal, stale-terminal rejection, Codex health/discovery separation, foreground `fetch failed`, background `exit 1`, and no retry. Real provider recovery remains evidence-gated.
- [x] 3.5 Provide evidence references for user acceptance; live-provider recovery remains evidence-gated rather than claimed from local tests.

## 4. Pi provider failure TDD

- [x] 4.1 Trace Pi `AssistantError` / process exit and background-task notification paths to their terminal `EngineEvent`s.
- [x] 4.2 Add red tests for a foreground `fetch failed`, a background-task `exit 1`, and an error after prior tool output.
- [x] 4.3 Add a bounded, secret-safe failure envelope that preserves provider/model, runtime mode, failure surface, error category, task id when present, and prior-output flags.
- [x] 4.4 Verify no automatic prompt/background-task retry occurs; document the `openai-codex` / Kimi / GLM evidence matrix and require evidence before provider-specific recovery changes.
