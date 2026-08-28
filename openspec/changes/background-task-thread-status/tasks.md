# Tasks: background-task-thread-status

## 1. Phase 1 · reducer 状态位（TDD 先行）

- [x] 1.1 `threadReducerTypes.ts`：`ThreadActivityStatus` 追加 `backgroundTaskRunningCount?: number`；`ThreadAction` 追加 `markBackgroundTaskActivity { workspaceId, threadId, runningCount }`
- [x] 1.2 `useThreadsReducer.ts`：实现 action——count 与 `hasUnread` 均不变时返回原引用；`prev > 0 && next === 0 && 非活跃线程` 时同步置 `hasUnread = true`
- [x] 1.3 reducer 单测：写入 / 引用稳定 / 0 跨越触发 unread / 活跃线程不触发 / 同值重复 dispatch no-op / 已删除线程无异常
- [x] 1.4 修复 status 写点抹除（D9 真机事故）：`markProcessing`（true/false）与 `markContextCompacting` 显式枚举补 `backgroundTaskRunningCount` 保留；回归测试锁定 markProcessing / markContextCompacting 往返不丢计数

## 2. Phase 2 · store 枚举 API + 单订阅 sync

- [x] 2.1 `backgroundTaskStore.ts`：新增 `listBackgroundTaskRunningCounts()`（复用 running 过滤语义，排除 `tool:` 占位）
- [x] 2.2 新增 `src/features/threads/utils/threadBackgroundTaskStatusSync.ts`：导出纯函数 `diffBackgroundTaskRunningCounts` + hook `useThreadBackgroundTaskStatusSync(dispatch)`
- [x] 2.3 sync 单测：写入 → dispatch 载荷与次数；无变化不 dispatch；clear 归零路径
- [x] 2.4 `useThreadEventHandlers.ts` 挂载 sync（`useThreadItemEvents` 调用旁，单挂载）

## 3. Phase 3 · 投影链与会话行渲染

- [x] 3.1 `useSidebarThreadStatusProjection.ts`：`SidebarThreadRowStatus` / `SourceThreadStatus` / reusePrevious 判定扩第四位
- [x] 3.2 `threadRowStatusStore.tsx`：`ThreadStatusMap` 与 `areThreadRowStatusesEqual` 扩第四位
- [x] 3.3 `ThreadList.tsx`：右侧 meta 运行状态点分流插 `bg-running`（reviewing > processing > bg-running > completed；左侧 `thread-status` 保持原四态，D8 真机验收反馈修订：第四态从左侧改右侧）；`statusVersion` memo 键追加 count 段；运行点旁渲染 `thread-bg-task-count` 徽标（count > 0 即显示）；`runtimeIndicator` 补 label 分支；`isExitedThread` 把后台任务运行中的会话视为未退出（hideExitedSessions 过滤下保持可见）
- [x] 3.4 `sidebar.css`：`.thread-runtime-dot--bg-running`（紫 `#a55eea`，复用 breathe keyframes 与同款 halo）+ `.thread-bg-task-count` 徽标样式（均含 light 变体）；`prefers-reduced-motion` 覆盖追加 `.thread-runtime-dot--bg-running`
- [x] 3.5 测试：projection 第四位引用稳定；ThreadList class 分流 / 徽标渲染 / 蓝灯+徽标并存

- [x] 4.1 `workspaceSessionActivityCompose.ts`：`threadIsProcessing` 并入 `backgroundTaskRunningCount > 0`（`ThreadStatusSnapshot` 补字段）+ compose 单测（仅后台任务运行时计活跃）
- [x] 4.2 i18n：`threads.runtimeBackgroundTasks` 文案（10 个 locale 全量）
- [x] 4.3 回归：`npm run check:app-shell:governance` 22/22、session-activity 201/201、投影/rowStatus 消费方与 i18n parity 全绿；`git diff --stat` 自查无格式化噪音；tsc 仅剩在途工作的存量错误
- [x] 4.6 registry watcher 上收 app 级（D10 真机事故修复）：`useBackgroundTaskRegistryWatcherForRunningThreads` 枚举 running>0 会话探测，挂 `useThreadEventHandlers`；strip 旧挂载移除；probeThreadTasks 抽取复用；切走会话后终态经 sink 全路径回写时间线卡片
- [x] 4.7 backgroundTask 终态绕过 turn 终态守卫（D11 真根因修复）：`handleItemUpdate` 加 `options.skipTurnTerminalGuard`，`onBackgroundTaskUpdated` 传入；回归测试锁定「settled 线程普通 item 仍被丢 + backgroundTask 终态 upsert 放行」
- [ ] 4.4 真机手工验收：pi 会话 bg_run → 切走 → 紫灯 + ⚙N 徽标；全部终态 → 灯灭 + 非活跃会话未读点；模型生成中蓝灯 + 徽标并存；reduced-motion 降级静态；重启后已终态任务不误亮；**任务结束后幕布卡片 ≤3s 内原地折叠（无需切会话/重开）**
- [ ] 4.5 收口：`openspec` validate / archive 流程，同步 capability spec
