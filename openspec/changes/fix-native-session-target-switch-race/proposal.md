# fix-native-session-target-switch-race

## Why

多个 Native CLI session（尤其 PI CLI ↔ PI CLI，也包含跨 CLI）快速切换时，session identity 已同步切到目标线程，但 `activeEngine` 被 chrome `startTransition` 延后。Composer 在此窗口仍按旧引擎 catalog 投影，可能把目标 PI session 显示成 Kimi 的默认 `kimi-coding/k3`；持续 streaming 会放大该窗口。

此外，native picker display、`composerSelectionResolverRef` 与 send target 不是同一带归属的 snapshot。若用户在切换首帧发送，旧线程 resolver 理论上可被读取，造成 visual target 与 request target 不一致。

## What Changes

- Active native thread 的 Composer engine 以同步 thread identity 派生，不等待 deferred chrome `activeEngine`。
- 将 native Composer resolver 变成带 `threadId` 与 revision 的 selection snapshot；native send 只能使用与 requested thread 匹配的 snapshot。
- thread mismatch 时 fail-closed，回退当前 thread ledger / resolved target，绝不复用旧线程 model、profile 或 effort。
- 为 PI↔PI、Kimi↔PI 快切和首帧 send 增加 TDD 回归测试。

## Non-Goals

- 不改变 Shared Session 的 `selectedNextTarget` 合同。
- 不在 click path 调 `refreshEngineModels`、`get_engine_models` 或 disk scan。
- 不把全部 chrome 更新改为同步，保留 session-switch 性能隔离。

## Impact

- `src/app-shell/domains/useAppShellComposerModelSection.ts`
- `src/app-shell/domains/composerSelectionResolver.ts`
- `src/features/threads/hooks/useThreadMessaging.ts`
- native Composer tests、thread messaging tests
