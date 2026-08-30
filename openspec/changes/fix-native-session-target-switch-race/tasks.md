# fix-native-session-target-switch-race · tasks

## 1. TDD red

- [x] 1.1 Add Composer model-section test: a `pi:` active thread with a deferred stale Kimi global engine projects its PI ledger target, not Kimi default.
- [x] 1.2 Add resolver/send test: stale resolver for thread A cannot supply model/profile/effort to native send for thread B.

## 2. Implement

- [x] 2.1 Derive active native Composer engine from thread identity while preserving deferred chrome behavior.
- [x] 2.2 Scope and revision `ComposerSelectionSnapshot`; publish resolver atomically with the active thread selection.
- [x] 2.3 Guard native send resolver use by requested thread identity and use safe current-thread fallback.

## 3. Verify

- [x] 3.1 Focused Vitest tests pass.
- [x] 3.2 `npm run typecheck` passes.
- [ ] 3.3 `npm run check:app-shell:governance` passes — blocked by pre-existing `useEngineAvailabilityProjection{,.test}.tsx` direct `app-shell/` imports; 21/22 checks pass.
- [ ] 3.4 Manual streaming fast-switch matrix recorded.
