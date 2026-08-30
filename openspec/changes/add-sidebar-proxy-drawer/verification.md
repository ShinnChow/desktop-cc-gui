# Verification: add-sidebar-proxy-drawer

## Passed

- `openspec validate add-sidebar-proxy-drawer --strict`
- `npm exec -- vitest run src/features/app/components/Sidebar.test.tsx -t "opens a proxy drawer|pins up to two settings actions" --pool=forks --maxWorkers=2`
- `npm exec -- vitest run src/features/settings/components/SettingsView.test.tsx --pool=forks --maxWorkers=2` (59 passed)
- Targeted pi-lens LSP check reported 0 primary language-server diagnostics for the edited TypeScript files.

## TDD evidence

The new sidebar drawer test first failed because the network-proxy menu item did not exist. It passes after implementation and verifies drawer opening, default `http://127.0.0.1:7890`, immediate enable persistence, and explicit save of an edited `socks5://` URL.

## Known unrelated blockers

- Full `Sidebar.test.tsx`: one pre-existing/concurrent failure remains at `triggers workspace engine refresh from the menu refresh button` (`onRefreshEngineOptions` not invoked). The new proxy test passes in the same suite.
- `npm run typecheck`: remaining errors are concurrent changes in `MessagesCore.tsx` and `useMessagesRuntimeState.test.tsx` concerning `backgroundTaskAwaitingStartedAt` and optional `backgroundTaskEarliestStartTime`.
- `npm run check:app-shell:governance`: runtime contract and six governance suites pass; `appShellFeatureBoundaries.test.ts` fails on concurrent direct `app-shell/` imports from `features/composer/components/ChatInputBox/hooks/useEngineAvailabilityProjection{,.test}.tsx`.

## Manual QA

Not run. Verify normal and swapped desktop layouts: the ladder entry appears immediately above Settings, opens a non-modal drawer, preserves/saves URL, toggles immediately, and closes via × or Escape.
