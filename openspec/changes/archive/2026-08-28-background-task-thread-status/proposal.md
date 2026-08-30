# background-task-thread-status

## Why

pi 会话经 `bg_run` 拉起后台任务后，turn 在工具返回时即 settle（`agent_settled`），前端 `onTurnCompleted` 无条件 `markProcessing(false)`（`useThreadTurnEvents.ts:670`），会话行蓝色呼吸灯熄灭。但后台 durable 任务仍在跑（`.pi/tasks/` 下带 PID 的进程），用户切走会话后**没有任何信号能回答「这条对话到底完成了没」**；任务多时更无从知道推进到哪一步。

2026-08-26 的 `pi-background-task-experience` 把等待态放在了 composer run-status pill 与时间线活体卡上（当时刻意不接 sidebar，并否决了引擎层阻塞 settle），但这两个载体只在「当前打开的会话」里可见——列表层与雷达层的缺口仍在：

- 呼吸灯唯一驱动源是 `threadStatusById[threadId].isProcessing`，后台任务状态（`backgroundTaskStore`）与 `threadStatusById` 两条状态链完全解耦；
- 会话雷达 `workspaceSessionActivityCompose.ts:645` 的 `threadIsProcessing` 同样只看 `isProcessing`；
- 全部任务转终态的「最终完成」时刻没有任何收口信号（用户在别的会话里感知不到）。

数据源已齐备且事件驱动（`backgroundTaskStore` 四路写入 + registry watcher 兜底），缺的只是把 running 计数并进会话行状态投影。

## 目标与边界

- **「对话是否完成」在列表层可判**：存在运行中后台任务的会话行显示独立第四态呼吸灯（紫色 `#a55eea`），与蓝灯（模型生成中）语义分离。
- **任务量可见**：运行中计数以徽标形式上会话行（如 `⚙2`），不点进会话也能看到量级；细节仍由既有 composer pill / 活体卡承载，不新建总览 UI。
- **终态收口**：某会话 runningCount 从 >0 跨到 0（completed / failed / killed 均算终态）时——非活跃线程标 unread（橙点提示可回看）；活跃线程只熄灯（时间线活体卡原地折叠已是信号）。
- **雷达同步**：会话雷达的活跃度判定并入后台任务运行态。

## What Changes

- **S1 状态位**：`ThreadActivityStatus` 新增 `backgroundTaskRunningCount?: number`；threads reducer 新增 action `markBackgroundTaskActivity { workspaceId, threadId, runningCount }`，值不变时保持引用稳定；0 跨越 + 非活跃判定在 reducer 内完成（跨到 0 且 `activeThreadIdByWorkspace[workspaceId] !== threadId` 时同步置 `hasUnread = true`）。
- **S2 单订阅 sync**：新模块 `threadBackgroundTaskStatusSync` 订阅 `backgroundTaskStore` 版本号，枚举各 `(workspaceId, threadId)` 的 runningCount 与上次快照 diff，仅变化的线程 dispatch S1 action。一处接线覆盖全部四路写入（item/started、receipt/notification、registry watcher、历史 hydrate）+ `clearBackgroundTasks`，不侵入 loader。
- **S3 投影与渲染**：`useSidebarThreadStatusProjection` / `threadRowStatusStore` 投影位与 equality 扩第四位；`ThreadList.tsx` 右侧 meta 运行状态点（`thread-runtime-dot`）分流插入 `bg-running`（优先级 reviewing > processing > bg-running > completed，左侧 `thread-status` 保持原四态）；运行点旁渲染计数徽标（独立于运行点颜色，`runningCount > 0` 即显示）；`sidebar.css` 新增 `.thread-runtime-dot--bg-running`（复用 breathe keyframes，紫色）与 `.thread-bg-task-count` 徽标样式 + `prefers-reduced-motion` 覆盖。
- **S4 雷达**：`workspaceSessionActivityCompose.ts` 的 `threadIsProcessing` 改为 `isProcessing || backgroundTaskRunningCount > 0`。

## 非目标

- 不做引擎层 settle 阻塞（8-26 提案已裁决否决：会话本身空闲可继续对话，锁死 composer 更割裂）。
- 不动 `threadBackgroundActivityProjection.isRunning`（行为层，如关闭按钮守卫）——本期只做信号可见性，不改行为约束。
- 不动消息流 `WorkingIndicator`；不渲染 topbar tabs 新状态（共享投影类型扩第四位，但 topbar 不加 UI）。
- 不做跨会话全局任务总览入口、任务取消/kill、进度百分比（数据源只有 running / 终态计数）。
- 纯前端变更：零 Rust 改动、零 canonical event 契约改动，不触发基石文档校准 Gate。

## 方案取舍

| 选项 | 说明 | 取舍 |
| ------ | ------ | ------ |
| A 引擎层阻塞 settle（Claude WaitBgTasks 做法） | 未终态不发 TurnCompleted | 否（8-26 已裁决；锁 composer 更割裂） |
| **B threads reducer 聚合第四态（选定）** | 单订阅 sync → reducer 状态位 → 投影链，sidebar 与雷达一处接线全吃到 | 是 |
| C row status store 层合流（不动 reducer） | `ThreadRowStatusProvider` 订阅 store 合并 | 否（雷达读的是 `threadStatusById`，要单独再接线，语义散两处） |
| 灯色琥珀 | 与「未完成」直觉贴近 | 否（unread 橙点 `#ff9f43` 同色系，且终态瞬间恰好琥珀灭→橙点亮，切换不可辨；改紫 `#a55eea` 与现有蓝/浅蓝/橙/绿全正交） |

## Capabilities

### Modified Capabilities

- `pi-background-task-experience`：ADDED Requirements——会话行第四态呼吸灯、行内运行计数徽标、终态 unread 收口、雷达活跃度并入、性能红线。

## Impact

- `src/features/threads/hooks/threadReducerTypes.ts`（`ThreadActivityStatus` + action 类型）
- `src/features/threads/hooks/useThreadsReducer.ts`（新 action 实现）
- `src/features/messages/utils/backgroundTaskStore.ts`（新增枚举 API `listBackgroundTaskRunningCounts()`）
- `src/features/threads/utils/threadBackgroundTaskStatusSync.ts`（新文件 + 测试）
- `src/features/threads/hooks/useThreadItemEvents.ts` / `useThreadEventHandlers.ts`（挂载 sync）
- `src/features/threads/hooks/useSidebarThreadStatusProjection.ts`、`src/features/app/components/threadRowStatusStore.tsx`（第四位）
- `src/features/app/components/ThreadList.tsx`、`src/features/app/utils/threadRowProjection.ts`（statusVersion 键）
- `src/styles/sidebar.css`（`.thread-status.bg-running` + reduced-motion）
- `src/features/session-activity/adapters/workspaceSessionActivityCompose.ts`（雷达）

## 验收标准

- pi 会话 `bg_run` 后切到别的会话：原会话行右侧显示紫色呼吸点 + 运行计数徽标（左侧状态点保持原四态）；模型生成中（蓝点）与后台任务并存时蓝点 + 徽标同显。
- 全部后台任务转终态（含 failed / killed）：紫灯熄灭；非活跃会话行出现未读点，活跃会话不出现。
- 会话雷达把「仅后台任务在跑」的会话计为活跃。
- 重开 app 历史加载后：已终态任务不误亮紫灯（hydrate 只补缺、按状态计数）。
- 相关单测全绿；`npm run check:app-shell:governance` 通过。
