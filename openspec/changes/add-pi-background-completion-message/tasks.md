# Tasks

## 1. Rust 提取与规范化

- [x] `parse_pi_background_task_notification`：`details.summary` → `details.result` → content XML（同标签序）提取清洗文本，写入任务快照 `completionText`；剥离 XML 标签、压缩空白。
- [x] 机器口径摘要（"Background task … completed/failed/killed/cancelled" 前后缀匹配）不算人类可读：不产出或移除既有机器 `completionText`。
- [x] `cargo test --lib engine::pi` 覆盖 summary/result/XML fallback 与机器摘要剔除。

## 2. 前端卡片展示（实时/历史同源）

- [x] `CanonicalBackgroundTask` + `parseBackgroundTaskSnapshot` + `canonicalBackgroundTaskFromRecord` 透传 `completionText`。
- [x] `BackgroundTaskCard` 终态折叠详情新增 summary 行（复用 `messages.backgroundTaskFoldFieldSummary` 键）；运行中卡不展示。
- [x] 卡片渲染测试：有 `completionText` 出 summary 行、无则不出。

## 3. 对齐守卫（实时幕布不得比历史多出行）

- [x] `onBackgroundTaskUpdated` 终态通知保持「只翻任务卡」：不追加 assistant 气泡、不复燃处理中（turnless post-settle 守卫测试保留并加强）。
- [x] live store 断言：通知 `completionText` 合并进 `backgroundTaskStore` 记录，与历史 `toolOutput` 合并同口径。

## 4. 验证

- [x] `cargo test --lib engine::pi`（98/98）、daemon_state 测试（15/15）、`rustfmt --check` 过。
- [x] `npx vitest run useThreadItemEvents piHistoryParser BackgroundTaskCard` 全绿；`tsc --noEmit`、eslint（改动文件）过。
- [ ] 随下一安装版构建真机复验：bg 任务完成后实时幕布出现后续汇总（`fix-pi-rpc-external-turn-steer-adoption` 任务 7 联动），任务卡 summary 行实时/历史一致。
