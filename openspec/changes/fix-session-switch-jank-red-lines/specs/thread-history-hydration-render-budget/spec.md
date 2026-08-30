# thread-history-hydration-render-budget Specification

## ADDED Requirements

### Requirement: Thread History Hydration SHALL Respect A Root Commit Budget

会话切入的 hydrate 阶段（历史加载完成到首屏数据就绪）SHALL 受根级 React commit 预算约束：元数据落库（plan / historyRestoredAt / historyWindow / tokenUsage / ensureThread 行合并）MUST 与首个数据 dispatch（tail-first 首屏 items）合批为单次状态转移，MUST NOT 逐字段独立 dispatch 造成多次全树 commit。单会话切入 hydrate 阶段根级 commit 数 SHALL ≤3（curtain 组 / 数据+元数据组 / progressive 收尾组，收尾组仅 >首屏窗口的大会话存在）。

既有细粒度 action（`ensureThread` / `setThreadPlan` / `setThreadHistoryRestoredAt` / `setThreadHistoryWindow` / `setThreadTokenUsage`）SHALL 保留供 resume 之外路径使用；组合 action 与细粒度路径 MUST 复用同一份 reducer 纯函数，最终状态 MUST 与逐个 dispatch bit 级一致。

#### Scenario: 小会话切入单次数据 commit

- **WHEN** 一个 ≤首屏窗口（300 条）的会话被切入且历史加载完成
- **THEN** ensure 行合并、首屏 items、plan、restoredAt、window、tokenUsage 在单次 dispatch 内全部生效
- **AND** hydrate 段根级 commit 计数 ≤ 约定预算

#### Scenario: 组合路径与细粒度路径终态一致

- **WHEN** 同一份 hydrate 输入分别经组合 action 与逐个细粒度 action 应用
- **THEN** reducer 终态 MUST deep-equal

#### Scenario: 大会话 progressive 收尾不回退

- **WHEN** 大于首屏窗口的会话被切入
- **THEN** 首屏行为与现有 tail-first 窗口语义一致
- **AND** 后续 progressive chunk 的既有 dispatch 模式保持不变
