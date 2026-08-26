# pi-background-task-experience · spec delta

## Purpose

PI 会话中经 pi-background-tasks 扩展（`bg_run` 等工具）启动的后台任务，MUST 在消息流与 composer run-status 工具条中作为一等公民呈现：有身份、有生命周期、有健康信号；turn settle 不得伪装成任务完成；唤醒通知 MUST 被消费而非渲染为裸用户消息。

## ADDED Requirements

### Requirement: 后台任务工具调用 SHALL 产出 backgroundTask canonical item

pi engine 事件转换 MUST 识别后台任务工具调用（`bg_run` / `bg_delegate` / `bg_run_pi_attested` / `fusion_*`），从 tool result receipt 提取 `taskId` / `name` / `outputPath`，产出 canonical `backgroundTask` item；receipt 解析失败时 MUST 降级为普通工具卡，不得阻塞消息流。

#### Scenario: bg_run receipt 正常解析

- **WHEN** pi 会话中模型调用 `bg_run` 且 tool result 为合法 receipt JSON
- **THEN** 时间线 MUST 出现对应 `backgroundTask` item，携带 taskId 与任务名

#### Scenario: receipt 解析失败降级

- **WHEN** 工具结果不是合法 receipt（扩展版本变化或格式不符）
- **THEN** 该调用 MUST 按普通工具卡渲染，消息流不得中断

### Requirement: 任务卡运行中 SHALL 是活体，终态 SHALL 原地折叠

`backgroundTask` 卡片在未终态时 MUST 展示运行中状态（elapsed 计时、输出 tail 预览、心跳文案，信号可得时）；到达终态时 MUST 原地折叠为 fold 行（状态 pill + 名称 + 耗时/退出码），用户可重新展开查看明细。历史重载时 MUST 直接以折叠态回放。

#### Scenario: 完成自动折叠

- **WHEN** 后台任务到达完成终态
- **THEN** 活体卡 MUST 原地替换为折叠行，显示耗时与 exit code，不再保持展开面积

#### Scenario: 历史回放折叠态

- **WHEN** 重新打开包含已终态后台任务的 pi 会话
- **THEN** 任务卡 MUST 以折叠态出现，不经历展开动画

### Requirement: 唤醒通知 SHALL 被消费，不得渲染为裸用户消息

`<background-task-notification>` 通知 MUST 被 `agentTaskNotification` 解析器识别并消费：按 taskId 驱动对应任务卡原地折叠、写入终态摘要；该通知 MUST NOT 渲染为用户 bubble，MUST NOT 作为 turn 边界的用户提问，MUST NOT 单列时间线行。解析器边界 MUST 保持硬化（空结果 / 双重转义 / 普通 XML 散文不误吞）。

#### Scenario: 通知驱动折叠并接续

- **WHEN** 扩展注入 `<background-task-notification>`（status: completed）触发 followUp turn
- **THEN** 对应任务卡 MUST 原地折叠，时间线上不得出现该通知的用户气泡，后续 assistant 消息正常接续

#### Scenario: 普通 XML 散文不误吞

- **WHEN** 用户或模型正文出现形似 `<background-task-notification>` 的普通文本（转义 / 残缺 / 散文引用）
- **THEN** 解析器 MUST NOT 误判为通知

### Requirement: 存在未终态后台任务时 composer 工具条 SHALL 显示后台任务 pill

composer run-status 工具条 MUST 在本会话存在后台任务时显示「后台任务」pill：有运行中任务时带 live dot 并显示运行中计数；turn settle 后 pill MUST 持续存在直到任务全部终态；点击 pill MUST 就地展开 panel，列出任务分组（运行中/已完成/失败）与日志入口。无后台任务时 MUST NOT 占位。

#### Scenario: settle 后 pill 常驻

- **WHEN** turn 因 `agent_settled` 结束且存在未终态后台任务
- **THEN** pill MUST 保持显示「N 个运行中」，会话不得呈现无活动的空闲假象

#### Scenario: 全部终态后归于平静

- **WHEN** 所有后台任务到达终态
- **THEN** pill MUST 停止脉冲并显示完成计数；按既有 strip 可见性规则决定是否保留

### Requirement: 通知丢失 SHALL 被 registry watch 兜底标记（P2）

当 registry watch 可用时，系统 MUST 监听 `.pi/tasks/session-<pid>/` metadata 与宿主进程存活；metadata 停更且进程退出且未收到完成通知时，对应任务 MUST 标记为「异常终止」，不得长期停留「运行中」。pid 目录与当前 resident 不匹配时 MUST 降级为仅通知驱动。

#### Scenario: 杀进程无通知

- **WHEN** 后台任务进程被外部终止且扩展未发出完成通知
- **THEN** 任务卡 MUST 标记「异常终止（未收到完成通知）」，pill 计数相应收敛

#### Scenario: registry 不可匹配降级

- **WHEN** 会话绑定的 resident pid 与 registry 目录不匹配（如 resume 旧会话）
- **THEN** 卡片 MUST 回退为仅通知驱动，不得显示假心跳

### Requirement: 性能红线 SHALL 守住

任务卡与 pill 的状态刷新 MUST 为事件驱动或组件本地 state；MUST NOT 将高频 setState（elapsed tick / tail 追加）接入根 hook 链或根 store；MUST NOT 引入秒级轮询。

#### Scenario: 长任务运行期间根渲染不受累

- **WHEN** 后台任务运行且 elapsed 每秒跳动、tail 持续追加
- **THEN** AppShell 根渲染路径 MUST NOT 因此出现每事件级 setState
