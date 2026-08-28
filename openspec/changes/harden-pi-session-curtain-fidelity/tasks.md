# Tasks

## 1. reconcile 排除名单补 pi 前缀（TDD red→green）

- [x] `useThreadRealtimeHistoryReconcile.test.tsx` harness 支持自定义 `threadsByWorkspace`
- [x] T1 列表 miss：`pi:{id}` 不在线程列表 → turn/completed 后不触发 refreshThread（red：refreshThread 被误调 1 次，实证嫌疑 1）
- [x] T1 pending：`pi-pending-{ts}` → 不触发 refreshThread（red 同上）
- [x] T1 稳态锁定：`engineSource: "pi"` 在列 → 不触发 refreshThread（green 回归锁）
- [x] 实现：`shouldReconcileCodexRealtimeThread` 排除名单补 `pi:` / `pi-pending-`
- [x] green 确认 8/8 + 既有 reconcile 用例全绿

## 2. pi load 失败可重试 + 降级记录（TDD red→green）

- [x] `useThreadActions.resume-guard.test.tsx` 补「load 抛错」用例（red：失败后 loaded 置位 + 二次 resume 不再 load）
- [x] 补「连续失败达上限」用例（red：5 次 resume 仅 1 次 load）
- [x] 实现：pi 分支 catch → `createThreadHistoryReadableSurfaceDebugEntry`（reasonCode
      `pi-history-load-failed`）+ 失败计数 ref + 上限 3 次后置 loaded 防风暴。
      注意不走 `markHistoryRecoveryFailure`：其内部置 automatic-recovery-failed
      会拦截后续 resume，关死重试通道（实施中发现并绕开）
- [x] 成功路径回归：load 成功时行为不变（loaded 置位、restoredAt dispatch）。
      附带修复 test-mocks 的 threadItems mock 缺 `buildConversationItem(FromThreadItem)`
      ——此前原生 parse 在测试环境必抛、pi 成功路径永远走 catch 被旧 catch 掩盖
- [x] green 确认 6/6

## 3. merge 锚点 miss 可观测（纯观测，零行为变化）

- [x] `applyHydratedItems` merge 路径：`merged === hydrated` 且
      `localItems.length > 0` 时打 debug（label
      `thread/hydrated merge anchor-miss fallback-to-disk`，附 itemCountBefore/After）
- [x] 观测用例：anchor-miss 场景 onDebug 收到 entry（6/6 绿，合并结果不变）

## 4. 验证与收口

- [x] 相关测试套件回归（reconcile 8/8、resume-guard 6/6、useThreadActions
      45/48——3 个失败经 HEAD stash 对照为存量红，名单逐一相同、与己无关、
      merge helper 4/4）
- [x] `tsc --noEmit` 通过（0 诊断）
- [x] `git diff --stat` 自查：5 文件 286+/24-，无格式化噪音（Format Discipline Gate）
- [ ] 真机待办（不阻塞收口）：本地起 pi resident 抓 RPC 事件，验证 live
      item id 与磁盘 entry id 同源性——结果决定「post-turn 磁盘回底移植」
      是否立项
- [x] ADR 校准回写 Gate：本 change 不涉 engine registry / Shared 支持集合 /
      provider binding / canonical fact schema / context compiler /
      terminal/ACK contract / recovery exit-abandon，无需回写基石文档

