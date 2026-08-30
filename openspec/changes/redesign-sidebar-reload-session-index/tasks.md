## 1. Loader

- [x] 1.1 在 `useThreadActions` 增加 index-only reload option；复用现有 Session Index projection、visibility/archive 过滤、request sequence，并在 dispatch 后跳过旧 catalog stages。
- [x] 1.2 为 index-only 路径补充成功路径测试，验证不会触发 legacy engine list services；复用 loader 既有的空结果、错误与乱序响应 guard。

## 2. Sidebar Handler

- [x] 2.1 删除 workspace reload 确认弹窗与过时 detail 文案，统一 quick/confirmed handler 传递强制 index-only 参数，并保留 main→child worktree cascade。
- [x] 2.2 更新 reload policy 测试，锁定直接使用 Session Index、无确认弹窗及 scope 行为。

## 3. Verification

- [x] 3.1 运行受影响 Vitest、`npm run typecheck` 与 `npm run lint`，记录结果并确认 diff 仅包含本变更范围。
- [x] 3.2 为菜单 reload 行增加 loading/disabled 回归测试，并验证 aria-busy 与 spinner class。

## 4. 收口记录（2026-08-30）

- [x] 门禁：`npm run typecheck`、受影响文件 eslint、`reloadWorkspaceThreads.policy` / `SidebarWorkspaceMenuOverlay` / `useThreadActions` 相关 Vitest、`openspec validate` 通过；确认弹窗移除后 10 个 locale × 7 个孤儿文案键已清理。
- [x] 已知存量（非本 change 引入，基线 af9fd2fa6 同样失败，记 follow-up）：`useThreadActions.test.tsx` 3 个 legacy 多引擎 fan-out 用例未 mock Session Index 服务导致 dispatch 顺序断言失败；`appShellFeatureBoundaries` T3.7 报 composer `useEngineAvailabilityProjection` 直连 app-shell/ 内部导入。
