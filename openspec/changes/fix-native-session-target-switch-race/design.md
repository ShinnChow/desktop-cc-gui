# fix-native-session-target-switch-race · design

## Context

`commitThreadSelection` intentionally applies `{workspaceId, threadId}` immediately and schedules engine/chrome with `startTransition`. The send path resolves native engine from `threadId`, while Composer model projection historically consumes global `activeEngine`; these sources can diverge during rapid switching or streaming.

## Decision

### 1. Composer engine is identity-derived for active native threads

When an active thread has a recognized native engine prefix, model catalog, effective model and reasoning projection use that engine immediately. The deferred global `activeEngine` remains responsible for chrome/Home state only. This keeps the click path IPC-free and preserves the existing performance intent.

### 2. Resolver is scoped and revisioned

`ComposerSelectionSnapshot` carries `threadId` and a monotonically increasing revision. A render may publish a resolver only for its active thread. Native send reads it only when `snapshot.threadId === requestedThreadId`; otherwise it must resolve from that thread's persisted selection/current target and never borrow a stale snapshot.

### 3. One target contract at send boundary

The comparison and fallback operate on model id, runtime model, provider profile and effort as one target. Tests assert all four fields, preventing label-only correctness.

## Risk / Mitigation

- Engine catalog may be unavailable during switch: retain current fallback/ledger behavior, but never substitute an old engine's default catalog row.
- The stricter resolver guard must not block non-native/Home sends: scope it to native active-thread sends and retain existing creation/Shared channels.
- No catalog refresh is introduced on click, per `session-switch-catalog-fetch-pitfall.md`.

## Verification

1. Red tests reproduce stale Kimi picker while a PI thread is already active.
2. Red tests reproduce A-resolver/B-thread immediate send.
3. Focused Vitest, `npm run typecheck`, and `npm run check:app-shell:governance` pass.
4. Manual: streaming PI session → repeatedly switch PI/Kimi/PI; picker follows each selected thread and next send receipt matches picker target.
