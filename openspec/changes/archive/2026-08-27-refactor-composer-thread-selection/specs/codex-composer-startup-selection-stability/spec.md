# codex-composer-startup-selection-stability Delta

## MODIFIED Requirements

### Requirement: Codex Startup Selection Repair MUST Be Idempotent

当 Codex composer startup selection repair 在 AppShell 首屏恢复期间运行时，系统 MUST 在逻辑值未变化时复用 previous state reference，并且不得因等价 selection、等价 catalog 或等价 reasoning effort 反复触发 React state updates。**此外，账本尚未同步到当前线程（切换窗口）时，repair MUST NOT 把 stale 账本值写进目标线程持久账本。**

#### Scenario: equivalent repair result does not enqueue a new state reference

- **WHEN** 应用冷启动进入已有 Codex 线程
- **AND** persisted thread selection 的 effective `modelId` 与 `effort` 已经等价于本轮 repair 结果
- **THEN** selection repair updater MUST return the previous state reference
- **AND** AppShell startup MUST NOT throw React `Maximum update depth exceeded`

#### Scenario: catalog recovery does not repeatedly rewrite equivalent selection

- **WHEN** workspace model catalog 从恢复中变为 ready
- **AND** 当前 thread-scoped selection 在恢复前后解析到同一 effective model / effort
- **THEN** 系统 MUST NOT repeatedly persist equivalent selection values
- **AND** 后续 render MUST converge without entering an update loop

#### Scenario: invalid selection still converges exactly once

- **WHEN** persisted thread selection 引用了当前 catalog 中不存在的 model 或不支持的 effort
- **THEN** 系统 MUST 将 selection 修复为有效 model / effort
- **AND** 修复完成后相同输入的下一轮 repair MUST reuse the previous state reference

#### Scenario: repair does not write during the thread-switch window

- **WHEN** 用户从 Codex 会话 A 快速切换到 Codex 会话 B
- **AND** 账本归属标志尚未同步到 B（selectedComposerSelection 仍是 A 的值）
- **THEN** repair MUST NOT 把 A 的 effective selection 写进 B 的持久账本
- **AND** 账本归属标志与 activeThreadId 一致后，repair MUST 恢复正常的幂等收敛语义
