## ADDED Requirements

### Requirement: PI 静默窗口 MUST 提供可解释的等待反馈

pi turn 的静默窗口（agent_start 之后、首个 `message_update` 之前）内，客户端 MUST 复用现有 `WorkingIndicator` 反馈底座（spinner + `WorkingClock` 秒表），并提供 pi 可辨识的等待文案与超时安抚提示；MUST NOT 为此新增 reducer 秒级 timer、新 IPC channel 或新渲染链轮询。

#### Scenario: 静默期显示等待首段文本文案

- **GIVEN** pi turn 已进入 processing（`markProcessing` 已落，`processingStartedAt` 非空）
- **AND** 最新用户消息之后尚无 assistant message item（`waitingForFirstChunk` 为 true）
- **WHEN** timeline 渲染 workingIndicator 行
- **THEN** 主文案 MUST 使用「等待首段文本」标签（`messages.waitingForFirstText`，含引擎名插值），而非泛化「响应中...」
- **AND** `WorkingClock` 秒表 MUST 继续以 ref 直写方式逐秒走动（口径仍为 `processingStartedAt`，不引入第二计时口径）

#### Scenario: 长静默触发安抚提示

- **GIVEN** pi 的 presentation profile `heartbeatWaitingHint` 为 true
- **AND** 静默窗口持续超过 `OPENCODE_NON_STREAMING_HINT_DELAY_MS`（12s）
- **WHEN** workingIndicator 行仍在等待首个 chunk
- **THEN** MUST 显示非流式 / 慢网络安抚提示文案（`messages.nonStreamingHint`）
- **AND** heartbeat pulse 驱动（`MessagesCore` timelineHeartbeatPulse）MUST 随 profile 同源点亮

#### Scenario: 首个 delta 到达后无缝切换

- **GIVEN** 静默期反馈已建立（等待文案 + 秒表 [+ 安抚提示]）
- **WHEN** 首个 `message_update`（`thinking_start`）落地渲染出 reasoning / tool 等可见流式 item（pi 的 `waitingForFirstChunk` 随之变 false；codex/qoder/dsh 维持 assistant-message 语义不变）
- **THEN** 等待文案 MUST 立即回落为正常 label，不闪烁、不重复、不多渲染一帧以上
- **AND** thinking 内容 MUST 经既有 reasoning 行通路接管渲染

#### Scenario: 不新增渲染链 timer

- **GIVEN** 阶段一实现任意时点
- **WHEN** review 静默期反馈的实现 diff
- **THEN** MUST NOT 出现 reducer 维护的秒级 tick（含 `thinkingMsSinceStart` 类字段）或新的 `setInterval` 进根 hook 链
- **AND** 既有 `WorkingClock` ref 直写与一次性 `setTimeout` 翻转（提示到点） MUST 是唯一的计时手段
