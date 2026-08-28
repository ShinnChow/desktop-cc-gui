# pi-background-task-experience Delta: fix-background-task-curtain-parity

## ADDED Requirements

### Requirement: 主会话 SHALL 显式表达后台等待态

当 active thread 的 foreground turn 已不在 streaming、但仍存在运行中 PI background task，conversation tail SHALL 显示非空 `background-awaiting` curtain，明确告知用户主对话正在等待后台任务结果。

#### Scenario: 主回合已完成，后台任务仍运行

- **GIVEN** `isThinking=false` 且 `backgroundTaskRunningCount=2`
- **WHEN** Messages 渲染 active thread
- **THEN** 显示"正在等待 2 个后台任务完成"的 tail curtain
- **AND** 显示任务结果将自动续接主对话的语义
- **AND** Composer 保持可用

#### Scenario: 新主通道流式数据抵达

- **GIVEN** thread 正处于 `background-awaiting`
- **WHEN** 新 foreground stream 使 `isThinking=true`
- **THEN** awaiting curtain 消失
- **AND** 恢复既有 main-channel streaming surface

#### Scenario: 后台任务全部终态而未续接 stream

- **GIVEN** `backgroundTaskRunningCount` 从正数变为 0，且 `isThinking=false`
- **WHEN** 状态同步完成
- **THEN** awaiting curtain 消失
- **AND** 沿用既有 task card / sidebar unread 收口语义

#### Scenario: 未安装 pi-background-tasks 插件

- **GIVEN** pi 引擎会话但插件未安装（无 backgroundTask 事件 / 无任务记录）
- **WHEN** Messages 渲染任意阶段
- **THEN** 不出现 `background-awaiting` curtain
- **AND** 既有幕布输出与其它引擎会话完全一致

#### Scenario: 非 pi 引擎会话

- **GIVEN** active engine 不是 pi
- **WHEN** Messages 渲染任意阶段
- **THEN** 不出现 `background-awaiting` curtain（`useBackgroundTaskRunningSnapshot` 按 engine 门控）

### Requirement: 任务取消终态 SHALL 收口 running 计数

background task 进入任一终态（含 `cancelled` / `canceled`）后，sidebar / pill 的 running 计数 SHALL 立即归零，不得让被取消的任务保持紫点 / unread。

#### Scenario: 任务被取消

- **GIVEN** 某 running 后台任务收到 `status=cancelled` 通知
- **WHEN** `backgroundTaskStore` 合并终态快照
- **THEN** 该会话 running 计数归 0
- **AND** thread-status sync dispatch 收口（unread 终态语义与 completed/failed 一致）

## REMOVED Requirements

### Requirement: 任务终态后主幕布 SHALL 持久输出系统文案行

**2026-08-29 废弃移除**：`backgroundTaskCompletion` 留痕行实现并实机验收后判定视觉噪音大于信息价值（多任务并行时悬挂成排；聚合与折叠优化仍不划算），整体拆除。终态表达收敛到任务卡翻态 + sidebar/pill 收口 + `background-awaiting` 幕布。
