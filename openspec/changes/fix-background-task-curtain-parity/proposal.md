# Change: fix-background-task-curtain-parity

## Why

PI `pi-background-tasks` 在 foreground turn 输出"已启动任务"后，会继续独立运行。当前 task card、Composer pill 和 sidebar 紫点均能表达 task status，但主 conversation 在最后一条 assistant message 后没有明确的 tail runtime surface；用户会自然理解为主对话结束。

这不是单纯的 status 缺失：它是 foreground stream → detached work → notification / new stream 的 lifecycle 在 UI 上断裂。

## What Changes

- 引入 `background-awaiting` presentation state：active thread 有 running background task 且没有 foreground stream 时，conversation tail MUST 显示明确、非空的 waiting curtain。
- curtain 显示 running count 与"等待任务结果，主对话将自动继续"的语义；不把 detached work 伪装为可取消 foreground turn，不锁 Composer。
- 当新的 foreground streaming ingress 抵达，`background-awaiting` MUST 立即退出，恢复既有 main-channel streaming surface。

## Removed（2026-08-29 复盘）

- ~~任务终态后主幕布持久输出 `backgroundTaskCompletion` 留痕行~~：已实现并试运行后**整体移除**。实测多任务并行时留痕行在幕布上悬挂成排（即使聚合为「1 行 + 数量 + 结束时间」、参与过程折叠仍不够干净），信息价值低于视觉噪音；终态事实已由任务卡翻态 + sidebar/pill 收口承载。等待语义完全收敛到 `background-awaiting` 幕布。

## Non-goals

- 不改变 PI RPC / task execution / registry watcher 的生命周期。
- 不自动替任务完成后不产生新消息的 agent 伪造回复。
- 不向幕布写入任何非模型产物的终态文案行（完成留痕行方案已废弃，见 Removed）。

## Impact

- `ConversationState` / Messages tail runtime presentation
- `TimelineRowRenderer` / `WorkingIndicator`（awaiting curtain surface）
- `backgroundTaskStore`：终态口径统一（cancelled/canceled 计入终态）+ 源码 NUL 字节转义修复（review 沉淀）
- TDD：task-awaiting 可见、new-stream handoff、count 0 收口
