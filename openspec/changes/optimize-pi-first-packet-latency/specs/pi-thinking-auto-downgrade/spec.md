## ADDED Requirements

### Requirement: PI 发送路径 MUST 支持默认档短消息按需降档

pi 发送路径在发送时刻执行降档判定：仅当「当前思考档为引擎默认档且本会话无用户手动改档记录 + prompt 极短 + 该 thread 无 assistant 历史」全部满足时，本 turn MUST 以 `low` 档发送；任一条件不满足或无法判定时 MUST NOT 降档。降档 MUST 仅作用于单 turn，MUST NOT 写回持久化的思考档偏好。

#### Scenario: 新会话首条短消息降档

- **GIVEN** engine 为 pi
- **AND** 思考档处于引擎默认档且本会话用户未手动改档
- **AND** prompt 长度 ≤ 阈值（初值 24 字符）且该 thread 无 assistant 历史
- **WHEN** 用户发送消息
- **THEN** 本 turn MUST 以 `low` 思考档执行 `set_thinking_level` / prompt 链路
- **AND** 持久化的思考档偏好 MUST 保持不变（下一 turn 恢复默认档判定）

#### Scenario: 用户手动设档永不覆盖

- **GIVEN** 用户在本会话通过 composer 显式设置过思考档（无论设为何值）
- **WHEN** 发送任意消息
- **THEN** MUST 使用用户设置的档位，MUST NOT 自动降档

#### Scenario: 不满足条件不降档

- **WHEN** 发生以下任一情况：prompt 超过阈值；该 thread 已有 assistant 历史；engine 非 pi
- **THEN** MUST NOT 触发降档，按原档位发送

#### Scenario: 无法判定时不降档

- **GIVEN** 「默认档 vs 用户设档」状态不可判定
- **WHEN** 发送消息
- **THEN** MUST NOT 降档（宁可不降不可错降）
