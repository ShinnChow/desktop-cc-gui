# pi-background-task-experience

## MODIFIED Requirements

### Requirement: 唤醒通知 SHALL 被消费，不得渲染为裸用户消息

`<background-task-notification>` 通知 MUST 被 `agentTaskNotification` 解析器识别并消费：按 taskId 驱动对应任务卡原地折叠、写入终态摘要；该通知 MUST NOT 渲染为用户 bubble，MUST NOT 作为 turn 边界的用户提问，MUST NOT 单列时间线行。解析器边界 MUST 保持硬化（空结果 / 双重转义 / 普通 XML 散文不误吞）。

终态通知中人类可读的完成描述（`<summary>` / `<result>` 清洗后）MUST 作为 `completionText` 落在任务卡快照上，并在终态折叠详情中可见；实时与历史 MUST 以同一字段、同一卡片组件展示。机器口径摘要（如 "Background task … completed"）与纯任务身份字段 MUST NOT 触发 summary 行；通知 MUST NOT 因 summary 追加任何独立时间线气泡（历史侧通知不成行，实时侧不得多出行）。

#### Scenario: 通知驱动折叠并接续

- **WHEN** 扩展注入 `<background-task-notification>`（status: completed）触发 followUp turn
- **THEN** 对应任务卡 MUST 原地折叠，时间线上不得出现该通知的用户气泡，后续 assistant 消息正常接续

#### Scenario: summary 展示且实时/历史同源

- **WHEN** 终态通知携带 `<summary>Hello world 5s</summary>`
- **THEN** 任务卡终态折叠详情 MUST 出现 `Hello world 5s`（summary 行）
- **AND** XML 标签与机器字段 MUST NOT 出现
- **AND** 实时幕布与历史重载后的任务卡 MUST 展示同一文本
- **AND** 时间线 MUST NOT 因该通知追加独立 assistant 气泡

#### Scenario: 机器口径摘要不产出 summary 行

- **WHEN** 终态通知的 summary 仅为 "Background task bg_1 completed" 这类机器拼接
- **THEN** 任务快照 MUST NOT 携带 `completionText`，折叠详情 MUST NOT 出现 summary 行

#### Scenario: 普通 XML 散文不误吞

- **WHEN** 用户或模型正文出现形似 `<background-task-notification>` 的普通文本（转义 / 残缺 / 散文引用）
- **THEN** 解析器 MUST NOT 误判为通知
