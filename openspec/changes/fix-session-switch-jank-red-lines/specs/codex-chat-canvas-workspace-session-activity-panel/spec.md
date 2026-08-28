# Delta: codex-chat-canvas-workspace-session-activity-panel

## ADDED Requirements

### Requirement: Radar Persistence Writes MUST Be Debounced

sessionRadar 持久化（`sessionRadar.recentCompleted` / `sessionRadar.readStateById` / `sessionRadar.dismissedCompletedAtById`）MUST 走 clientStorage 默认 debounce 合并通道，MUST NOT 以 `immediate: true` 绕过；内容签名未变化的重建 MUST 跳过写盘（既有签名比对语义保留）。流式期间 radar feed 的高频重建 MUST NOT 造成同步落盘。

#### Scenario: 切换会话触发 radar 重建不立即落盘

- **WHEN** 切入新会话导致 `mergedRecentFeed` 重建且持久化内容签名变化
- **THEN** 三类 key 的写入进入默认 debounce 合并通道
- **AND** 300ms 窗口内的多次重建合并为一次 patch

#### Scenario: 签名未变不写盘

- **WHEN** radar feed 因 deferred value settle 重建但持久化内容序列化后未变化
- **THEN** 不发起任何写盘调用
