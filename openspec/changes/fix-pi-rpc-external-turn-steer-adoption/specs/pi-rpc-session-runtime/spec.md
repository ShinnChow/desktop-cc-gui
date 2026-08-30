## MODIFIED Requirements

### Requirement: 发送语义 MUST 区分 idle prompt 与 streaming steer

系统 MUST 按 RPC 会话的 streaming 状态选择 `prompt` 或 `steer` 命令，并以 typed 事件而非进程生命周期判定 turn 终态。streaming 判定 MUST 以 resident 的 `is_streaming` 信号为准：本地无活跃 run 但 pi 仍在 streaming（pi 自唤醒 turn，如后台任务完成通知注入）时 MUST 视为 streaming，禁止按 idle 裸发 `prompt`。

#### Scenario: idle 时发送

- **WHEN** RPC 会话 `isStreaming == false`
- **THEN** 系统 MUST 发送 `prompt` 命令
- **AND** turn 终态 MUST 以 typed `agent_settled` 为准，进程退出只算 cleanup

#### Scenario: streaming 时融合发送

- **WHEN** RPC 会话 `isStreaming == true` 且 delivery decision 为 same-run steer
- **THEN** 系统 MUST 发送 `steer` 命令
- **AND** steered user message MUST 由前端乐观气泡上幕布（`wasProcessing && steerEnabled` 既有链路）
- **AND** 后端 MUST NOT 重复投影 user echo（避免双气泡）

#### Scenario: 中断

- **WHEN** 用户中断当前 turn
- **THEN** 系统 MUST 发送 `abort` 命令
- **AND** 2s 内未 settle MUST kill 进程兜底
- **AND** 无活跃 run 时 MUST NOT abort 或等待 grace（空闲中断零延迟）

#### Scenario: turn 超时一次结算

- **WHEN** RPC turn 超过 10min 未 settle
- **THEN** 系统 MUST 摘下 run 并以同一错误结算全部 waiter（main + attached steer），随后 abort
- **AND** 同一 turn MUST NOT 收到第二次终态（迟到 `agent_settled` 或 stale-settle 自愈面对空 run 直接跳过；已结算路径 MUST NOT 被外层重发 TurnError）

#### Scenario: 外部唤醒 turn 由 orphan run 承接

- **WHEN** RPC pump 收到 `agent_start` 且本 resident 无活跃 run（pi 自唤醒 turn，不经过 ccgui 发送路径）
- **THEN** 系统 MUST 创建 orphan run（合成 main turn id、无真实 waiter）承接该 turn 的事件流并累积 `response_text`
- **AND** `agent_settled` 到达时 MUST 按既有逻辑结算（含 `get_last_assistant_text` 回填）
- **AND** orphan run 的流式事件 MUST 发往合成 turn id，MUST NOT 冒充任何真实用户 turn（daemon 按 turn_id 过滤天然丢弃）

#### Scenario: streaming 无本地 run 时发送走 steer 并绑定下一个原生 turn

- **WHEN** 发送时本地无活跃 run 但 resident `is_streaming == true`
- **THEN** 系统 MUST 发送 `steer` 而非 `prompt`
- **AND** run 尚不存在时 MUST 先建 orphan run 再 attach
- **AND** attach 的真实 turn ID MUST 进入 pending 队列，并在下一个原生 `turn_start` 到达时绑定
- **AND** 外部 orphan turn 的已缓冲正文 MUST NOT 复制或回放到该用户 turn
- **AND** 新 turn 的 delta、`message_end` snapshot 与 `turn_end` MUST 使用同一个真实 turn ID
- **AND** MUST NOT 返回「会话失败」

#### Scenario: prompt 被 pi 以 already processing 拒绝时自动转 steer

- **WHEN** idle 判定后发出的 `prompt` 被 pi 拒绝且错误含「already processing」（判定与到达之间的竞态，被拒消息未入队）
- **THEN** 系统 MUST 自动改用 `steer` 重投同一条消息一次并按 steer attach 结算
- **AND** MUST NOT 向用户暴露「pi rpc prompt failed: Agent is already processing」
- **AND** 非 busy 类 prompt 错误 MUST 维持原样报错，不得重试

#### Scenario: streaming 期间禁止会话切换与模型对账变更

- **WHEN** resident `is_streaming == true`（含本地无 run 的外部 turn）
- **THEN** 发送前置检查 MUST 按活跃 run 处理，跳过 `align_rpc_session` 与 `reconcile_rpc_model`
- **AND** `align_rpc_session` MUST 拒绝 `switch_session`（同活跃 run 拒绝语义）
- **AND** `rpc_has_active_run_for` MUST 返回 true（fork/compact 守卫不被绕过）

#### Scenario: run 内前台 follow-up turn 实时投影（2026-08-30 实测校准）

- **WHEN** 一个 RPC agent run 内出现第 N（N≥2）个原生 `turn_start`（pi 的每个工具往返都是一个新原生 turn，实测 0.84.4）
- **AND** 本地无排队的用户 steer turn id
- **THEN** 非 orphan run MUST 为该 turn 分配派生前台 id `{main}:t{n}`（orphan run 仍用 `pi-external-*` 合成 id）
- **AND** daemon forwarder MUST 无条件放行 primary 本体与 `{primary}:t{n}` 派生 turn 的事件（它们是用户自己 run 的正文，不得套用外部 turn 门控）
- **AND** 每个 follow-up turn 的 delta、snapshot、`turn_end` MUST 使用同一派生 id，前端按 turn 生成独立 assistant 气泡
- **AND** 实时幕布的段落序列 MUST 与历史重载（session 文件逐 assistant 消息）一致

#### Scenario: forwarder 断开绑定 agent_settled 生命周期标记

- **WHEN** pump 收到 `agent_settled`（run 彻底 settle，无重试/无排队 continuation）
- **THEN** pump MUST 发出 `Raw{kind:"agent_settled"}` 生命周期标记
- **AND** daemon forwarder MUST 在「标记已到 + 后台任务全部回收 + 无活跃外部唤醒 turn」时才允许断开
- **AND** 第一个原生 turn 的 `TurnCompleted` 到达时 MUST NOT 断开（run 内通常还有后续原生 turn）
- **AND** 新的 `TurnStarted` 到达时 MUST 复位标记（后台唤醒紧跟 settled 开新 run）
