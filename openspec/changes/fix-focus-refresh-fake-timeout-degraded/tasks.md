# Tasks: fix-focus-refresh-fake-timeout-degraded

## 1. 红测试

- [x] 1.1 `useThreadActions.native-session-bridges.test.tsx` 新增用例：focus-refresh merge 运行后 `onDebug` 无 `thread/list claude timeout` / `thread/list codex catalog timeout`，且 dispatch 的 threads 无 `partialSource` timeout 标记与 `degradedReason: "partial-thread-list"`（先红：假 timeout 日志实测命中）。
- [x] 1.2 同用例断言 last-good Claude 行仍在最终列表（seed 兜底不回归）。

## 2. 实现

- [x] 2.1 `useThreadActions.ts`：claude timeout 分支的 `rememberPartialSource` + onDebug 加 `!isFocusRefreshMerge` 门控；catalog timeout 分支同理；seed 调用保持无条件。

## 3. 验证与收口

- [x] 3.1 红 → 绿：新用例转绿；HEAD worktree 基线对照零新增红——native-session-bridges 基线 5 failed/12 passed → 本 change 5 failed（同一 mock-gap 组，来自并行会话 ffe807619 未补 mock）/13 passed；thread-list-recovery 基线 7 failed → 本 change 7 failed（逐条一致）；timeout-fallback 基线 11 failed（同一 `rememberSessionIndexWorkspacePath` mock-gap，真实 timeout 契约测试被并行会话的 mock 缺口挡住，与本 change 无关）→ 本 change 11 failed（一致）。
- [x] 3.2 `npm run typecheck` exit 0 全树零 error；改动文件 prettier --write 后 clean（HEAD 两文件均 clean，仅本 change hunk 受影响）。
- [x] 3.3 `openspec validate --strict --no-interactive` 通过；README 索引更新（HEAD 基线 patch 只 stage 本 change 行）。
- [ ] 3.4 真机复验（随 0.9.4）：复现窗口 focus-refresh 后 diagnostics.json 不再出现成对假 `thread/list *timeout`，可见列表无 `partial-thread-list` 误标。
