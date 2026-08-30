# Design

PI Rust 通知解析（`parse_pi_background_task_notification`）在既有任务快照上增加 canonical `completionText`：结构化 `details` 优先取 `summary`、其次 `result`；XML fallback 解析同样的标签。清洗规则：剥离 XML 标签、压缩空白、剔除 "Background task … completed/failed" 这类机器口径摘要；全部为机器字段时不产出该字段。已有机器口径 `completionText` 时以新提取值覆盖或移除。

前端任务卡（`BackgroundTaskCard`）从两条同源路径读取同一字段：实时走 store 权威快照（`backgroundTaskStore` 全量合并 `task`，`canonicalBackgroundTaskFromRecord` 透传 `completionText`）；历史走时间线 `output` 快照（`parseBackgroundTaskSnapshot` 透传）。终态折叠详情中以 summary 行展示；运行中卡不展示（该字段只在终态通知出现）。

关键取舍——**completionText 锚定在任务卡上，而不是追加为独立 assistant 气泡**：历史回放把通知合并进卡片、通知本身永不成行（D1，主 spec「唤醒通知 SHALL 被消费」）；若实时侧追加气泡而历史侧没有对应行，重载后气泡消失，实时/历史幕布重新失配。卡片锚定让两侧用同一字段、同一组件渲染，对齐由构造保证。
