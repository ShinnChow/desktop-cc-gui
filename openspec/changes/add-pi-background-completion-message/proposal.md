# Change: add-pi-background-completion-message

## Why

PI 后台任务终态通知（`<background-task-notification>`）目前只驱动任务卡翻态，通知里人类可读的完成描述（`<summary>` / `<result>`）在主幕布上无处可看：任务卡不展示、通知本身按 D1「通知不成行」丢弃。用户在实时幕布上只看到卡片翻绿，看不到"任务到底输出了什么"，重载历史也一样看不见——信息在两侧同时缺失。

## What Changes

- Rust 侧（已完成）：从通知 `details`（优先 `summary`，其次 `result`）或 content XML 标签中提取清洗后的描述，规范化为任务快照的 canonical `completionText` 字段；机器口径的 "Background task … completed" 摘要不算人类可读描述。
- 前端任务卡展示 `completionText`：终态折叠详情新增 summary 行；实时（store 快照 / 时间线 upsert）与历史（`toolOutput` 合并）两侧走同一字段、同一组件，天然对齐。
- 通知本身保持不成行（D1）：**不**追加独立 assistant 气泡——若实时侧追加而历史侧没有对应行，重载后气泡消失，会制造反向的实时/历史不对齐（与本仓库"实时幕布与历史幕布对齐"的验收口径冲突）。

## Non-goals

- 不改任务执行与状态语义（运行/终态/回收口径不变）。
- 不在时间线渲染 task ID、exit code、路径或原始 XML（summary 行只展示清洗后文本）。
- 不改变通知驱动的 turn 接续行为（属 `fix-pi-rpc-external-turn-steer-adoption`）。
