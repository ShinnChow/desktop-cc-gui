# pi-background-task-experience

## Why

用户安装 pi 扩展 `pi-background-tasks` 后，PI 会话中模型频繁经 `bg_run` 把任务甩到后台。当前链路有三个断点，导致「前端显示停止了、其实后台还在跑」的割裂体验：

1. **断点 A · turn 状态说谎**：`bg_run` 一返回，pi 即发 `agent_settled`（`src-tauri/src/engine/pi_rpc.rs:12`），前端 spinner 停、composer 解锁、会话显示「空闲」，但逻辑任务远未完成。
2. **断点 B · 任务蒸发**：扩展的状态面（footer dock / `ctx.ui.setStatus` / widget）全是 pi TUI 钩子；codemoss 是 RPC headless host，全部不可达。消息流里只有一张一次性 receipt 工具卡，之后任务在界面上再无任何踪迹。
3. **断点 C · 裸通知**：完成唤醒经 `<background-task-notification>` 注入（`deliverAs: followUp`），现有解析器只认 Claude 的 `<task-notification>`（`agentTaskNotification.ts:10`），pi 的通知被渲染成裸 user bubble，且新 turn 与原任务无视觉关联。

同时**健康信号全缺**：运行中无 elapsed / 输出 tail / 心跳；通知丢失（pi resident 退出、扩展崩溃）时任务静默死亡，用户无从得知；无日志查看与聚合视图。

对照：Claude 链路有 backgroundTaskId settlement blocker（issue #983）+ `BackgroundTaskNotificationFold`，pi 链路两者皆无。

方案文档：`docs/plans/2026-08-26-pi-background-tasks-experience-plan.md`；设计稿（真壳）：`docs/designs/pi-background-tasks/index.html`。

## 目标与边界

- 后台任务在消息流是一等公民：有身份（taskId）、有生命周期、有健康信号（elapsed / 输出 tail / 终态）。
- turn 状态不说谎：存在未终态后台任务时，composer 上方持续有「后台任务」pill 表达等待。
- 唤醒通知被消费：驱动任务卡原地折叠 + 触发 followUp turn，不渲染为裸 user bubble、不单列时间线行。
- 通知丢失不错误等待：registry watch（`<cwd>/.pi/tasks/session-<pid>/`）能发现进程死亡并标记失败。

## What Changes

- **A1 任务卡**：pi.rs 事件转换识别 `bg_run` / `bg_delegate` / `bg_run_pi_attested` / `fusion_*` 工具调用，从 receipt 提取 taskId/name/outputPath，产出新 canonical item kind `backgroundTask`；前端 `BackgroundTaskCard` 活体渲染（运行中展开：elapsed + tail 预览 + 心跳），终态**原地折叠**为真实 `message-agent-task-fold` 行（对齐 0.9.0「Auto-fold completed terminal groups」）。
- **A2 通知消费**：`agentTaskNotification` 解析器扩展识别 `<background-task-notification>`；通知不渲染为 bubble / 不单列行，被消费为 ① 按 taskId 驱动 A1 原地折叠 ② 写入终态摘要 ③ 触发 followUp turn；不作为 turn 边界的用户提问（对齐 Claude wakeup 语义）。
- **A3+C 工具条 pill**：复用真实 `composer-run-status`（「子代理 2/2」同款）：composer 上方出现「后台任务 N 个运行中」pill（running 带 live dot），点击就地展开 panel 列出任务分组与日志；turn settle 后 pill 持续存在直到任务全部终态——等待态与聚合视图合并为一个构件。
- **B registry watch（P2）**：Rust 侧 watch `.pi/tasks/session-<pid>/<taskId>.json` + 输出日志，状态变更封装为 canonical event 推前端；metadata 停更 + 进程退出 + 通知未到达 → 任务标「异常终止」，消除假「运行中」。
- 基石设计校准行（pi engine 事件契约新增 backgroundTask item kind）。

## 非目标

- 不改变 pi / 扩展的后台执行行为（agent 何时用 bg_run 由模型与提示词决定）。
- 不做跨会话 / 跨工作区的全局任务中心。
- 一期不做任务取消（二期候选：kill 进程树 or 扩展 RPC 控制面，拍板后单开 change）。
- 不 patch pi、不 patch 扩展；扩展格式变化时降级为现状体验。

## 方案取舍

| 选项 | 说明 | 取舍 |
| ------ | ------ | ------ |
| A 引擎层阻塞 settle（抄 Claude WaitBgTasks） | pi RPC 无此语义，需等 pi 上游或 hack resident | 否 |
| **B UI 层等待态 + 活体任务卡（选定）** | turn 照常 settle，pill + 卡片表达等待；不动 pi 行为 | 是 |
| C 唤醒通知单列折叠行（仿 Claude） | A1 卡已是活载体，再出一行是重复信息 | 否（改为通知消费） |
| D 右侧 drawer / 模态对话框做任务中心 | 占布局 / 打断流；复用 run-status strip 更贴既有语言 | 否（改为工具条 pill + 就地展开 panel） |

## Capabilities

### New Capabilities

- `pi-background-task-experience`: PI 会话后台任务的一等公民契约——backgroundTask item 契约、通知消费、终态原地折叠、run-status pill、registry 健康信号。

### Modified Capabilities

- （可选）`agent-task-run-history`：若其 spec 已约束 task-notification 折叠行为，需补充 pi 标签变体的 MODIFIED 段；实施时核对。

## Impact

- `src-tauri/src/engine/pi.rs` / `pi_rpc.rs`（事件转换、customType 透出 spike）
- `src/features/engine-task-output/contracts/agentTaskNotification.ts`（解析器扩展）
- `src/features/messages/rows/components/`（BackgroundTaskCard 新组件）
- `src/features/composer/components/run-status/`（pill 数据源扩展）
- `src-tauri` registry watcher（P2，新增）
- 基石 `docs/research/mossx-multi-cli-provider-session-foundation-design.md` 校准表
- 设计稿 `docs/designs/pi-background-tasks/index.html`、方案 `docs/plans/2026-08-26-pi-background-tasks-experience-plan.md`

## 验收标准

- pi 会话 bg_run：通知不再裸 bubble；任务卡运行中（elapsed/tail/心跳）→ 完成自动原地折叠；followUp turn 视觉接续。
- 有未终态后台任务时 composer 上方 pill 常驻，可展开 panel 看任务与日志；全部终态后 pill 不再脉冲。
- 杀掉后台任务进程（不发通知）后 UI 标记「异常终止」而非永远运行中（P2）。
- 历史重载时任务卡直接以折叠态回放。
- Render Perf：elapsed/tail 全部组件本地 state + 事件驱动，无高频 setState 入根链、无秒级轮询。
