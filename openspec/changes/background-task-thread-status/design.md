# Design: background-task-thread-status

## 0. 背景与缺口

呼吸灯链路（现状）：

```
onTurnStarted → markProcessing(true)  ─┐
onTurnCompleted/abort/error → false   ─┤→ threadStatusById[threadId].isProcessing
                                        │     ↓ useSidebarThreadStatusProjection（三布尔位 + 引用稳定化）
                                        │     ↓ ThreadRowStatusProvider（per-row useSyncExternalStore）
                                        │     ↓ ThreadList.tsx statusClass → .thread-status.processing（蓝呼吸）
```

后台任务链路（现状，8-26 已建）：

```
Rust pi.rs（receipt / notification）+ registry watcher
  → AppServer events（item/started、item/backgroundTask/updated）
    → useThreadItemEvents 咽喉 → backgroundTaskStore（模块级 Map + 版本号订阅）
      → composer pill / 时间线活体卡
```

缺口：两条链零交集。pi 的 turn 在 `bg_run` 返回即 settle，灯灭，但 durable 任务仍在跑。

## 1. 数据流（目标态）

```
backgroundTaskStore 任意一路写入（started / receipt / notification / registry / hydrate / clear）
  → emitChange（版本号 +1）
    → threadBackgroundTaskStatusSync（模块级单订阅，挂 useThreadEventHandlers 层）
      ├─ listBackgroundTaskRunningCounts() 枚举 [{workspaceId, threadId, runningCount}]
      ├─ 与 lastKnown 快照 diff → 仅变化线程 dispatch markBackgroundTaskActivity
      └─ reducer 内判定：
          ├─ 写 threadStatusById[threadId].backgroundTaskRunningCount（不变则引用稳定）
          └─ prev > 0 且 next === 0 且非活跃线程 → 同步置 hasUnread = true
              ↓ 投影链（第四位）
              ├─ ThreadList 行：紫呼吸灯（bg-running）+ 计数徽标
              └─ workspaceSessionActivityCompose：threadIsProcessing 并入 count > 0
```

## 2. 决策记录

- **D1 灯色紫色 `#a55eea`，非琥珀**：unread 已占用橙 `#ff9f43`；终态瞬间是「琥珀呼吸灭 → 橙静态亮」，同色系切换看起来像灯没灭。紫色与蓝（processing）/ 浅蓝（reviewing）/ 橙（unread）/ 绿（ready）全正交，均为 flat-ui 系配色。
- **D2 单订阅 sync，非逐调用点 dispatch**：store 有四路写入，其中历史 hydrate 在 `piHistoryLoader` / `useThreadActionsResumeThread` 里没有 dispatch 通道；单一订阅点天然覆盖全部写入路径与未来新增路径（如 `clearBackgroundTasks`）。事件为低频生命周期事件（start / terminal），不踩 Render Perf 红线（禁高频 setState 挂根链——本链纯事件驱动，无轮询）。
- **D3 0 跨越 + 活跃判定收进 reducer**：单一 action 自带判定，sync 模块保持「纯 diff + dispatch」职责；reducer 天然持有 `activeThreadIdByWorkspace` 与 prev count，无双源竞态。重复 dispatch 同值时 prev 已归零，不会二次触发 unread。
- **D4 占位记录不计 running**：`countRunningBackgroundTasks` 现有语义已过滤 `tool:` 前缀占位（receipt 前的 item/started），灯亮时刻 = receipt 到达（bg_run 工具返回），与 started 间隔为命令启动时长（秒级），可接受；不改函数语义。
- **D5 徽标独立于灯色优先级**：`runningCount > 0` 即渲染徽标，与 statusClass 分流解耦——蓝灯（模型生成中）+ 徽标可并存，信息不丢失。
- **D6 topbar tabs 只扩类型不渲染**：共享投影位扩第四位是机械改动，topbar 消费方类型自然兼容，但不加新 UI（用户裁决范围：列表行 + 雷达）。
- **D7 不触发基石校准 Gate**：零 Rust 改动、零 canonical event 契约改动（只消费既有 `BackgroundTaskStarted/Updated` 的前端派生态），不在「更新触发器」清单内。

## 3. 各层设计

### 3.1 reducer（`threadReducerTypes.ts` / `useThreadsReducer.ts`）

```ts
// ThreadActivityStatus 追加
backgroundTaskRunningCount?: number;

// ThreadAction 追加
| {
    type: "markBackgroundTaskActivity";
    workspaceId: string;
    threadId: string;
    runningCount: number;
  }
```

实现要点：
- `runningCount` 与 `hasUnread` 均无变化时返回原 state 引用（对齐 `markProcessing` 写法）。
- 0 跨越判定：`prevCount > 0 && next === 0 && state.activeThreadIdByWorkspace[workspaceId] !== threadId` → `hasUnread: true`。活跃线程不标（用户正看着，活体卡原地折叠已是信号）。
- 对已删除线程写入无副作用（`threadStatusById` 是独立 map，与 `markUnread` 行为一致）。

### 3.2 store 枚举 API（`backgroundTaskStore.ts`）

```ts
export function listBackgroundTaskRunningCounts(): Array<{
  workspaceId: string;
  threadId: string;
  runningCount: number;
}>;
```

内部遍历 `tablesByThread`（key 为 `` `${workspaceId} ${threadId}` ``），逐表复用 `countRunningBackgroundTasks` 的过滤语义（status 非 completed/failed/killed，排除 `tool:` 占位）。表被 `clearBackgroundTasks` 删除后不再出现在枚举结果里，sync 据此 dispatch 0。

### 3.3 sync 模块（新 `src/features/threads/utils/threadBackgroundTaskStatusSync.ts`）

- `useThreadBackgroundTaskStatusSync(dispatch)`：`useSyncExternalStore`/手动 `subscribeBackgroundTaskStore` 订阅版本号；回调里枚举 + diff（`lastKnownRef`）+ 仅变化项 dispatch。
- 挂载点：`useThreadEventHandlers.ts` 中 `useThreadItemEvents` 调用旁（单挂载）。若同层多实例并存，双 dispatch 同值为 no-op（D3 已分析），无正确性风险。
- 纯函数 `diffBackgroundTaskRunningCounts(lastKnown, next)` 导出供单测。

### 3.4 投影链

- `SidebarThreadRowStatus` / `SourceThreadStatus` / `ThreadStatusMap` / `areThreadRowStatusesEqual` 追加 `backgroundTaskRunningCount`（number，缺省 0）。
- `projectSidebarThreadStatus` 的 reusePrevious 判定纳入第四位比较。
- `ThreadList.tsx` 行组件 `statusVersion` memo 键（现为三布尔串）追加 count 段，保证 `getThreadRowProjection` 的 LRU 缓存正确失效。

### 3.5 渲染（`ThreadList.tsx` + `sidebar.css`）

statusClass 分流（优先级从高到低）：

```
isReviewing        → reviewing（静浅蓝，不变）
isProcessing       → processing（蓝呼吸，不变）
bgCount > 0        → bg-running（紫呼吸，新）
hasUnread          → unread（静橙，不变）
兜底               → ready（静绿，不变）
```

- 徽标：状态点后渲染 `<span className="thread-bg-task-count">{count}</span>`，`count > 0` 即显示，与灯色分流解耦（D5）；样式对齐 meta-area 既有小徽标形态。
- CSS：`.thread-status.bg-running { background: #a55eea; box-shadow: 同款 halo; animation: sidebar-thread-status-breathe 1.8s ease-in-out infinite; }`；`prefers-reduced-motion` 覆盖规则（`sidebar.css:2977`）追加 `.thread-status.bg-running { animation: none; }`。
- `runtimeIndicator` label 分支同步补 `bg-running`（tooltip 文案「后台任务运行中」）。

### 3.6 雷达（`workspaceSessionActivityCompose.ts`）

`threadIsProcessing: Boolean(threadStatusById[thread.id]?.isProcessing)` 改为：

```ts
threadIsProcessing: Boolean(threadStatusById[thread.id]?.isProcessing)
  || (threadStatusById[thread.id]?.backgroundTaskRunningCount ?? 0) > 0
```

该位驱动 `resolveEventStatus` / `resolveExploreEventStatus` 的运行中判定，语义正是「还在跑」。

## 4. 边界与风险

| 场景 | 行为 | 依据 |
| --- | --- | --- |
| app 重启后历史加载 | 已终态任务 count=0 不亮灯；真 running 的历史任务会亮（registry watcher 兜底翻终态） | `hydrateBackgroundTasksFromHistory` 只补缺，按状态计数 |
| 会话删除 / 工作区清理 | `clearBackgroundTasks` → 枚举消失 → dispatch 0 → 灯灭 | sync diff 覆盖删除路径 |
| hydrate 与在途事件竞态 | hydrate 不覆盖 live 记录，count 以 live 为准 | store 既有「只补缺」语义 |
| 双实例 sync 重复 dispatch | 同值 no-op，0 跨越只触发一次 | D3 引用稳定性 + prev 判定 |
| reduced-motion | 紫灯降级静态点 | `sidebar.css:2977` 追加规则 |

## 5. 测试策略

- **reducer 单测**：count 写入与引用稳定性；0 跨越触发 `hasUnread`；活跃线程不触发；同值重复 dispatch 无副作用；删除线程无异常。
- **sync 单测**（含 `diffBackgroundTaskRunningCounts` 纯函数）：store 写入 → dispatch 次数与载荷；clear 归零；无变化不 dispatch。
- **projection 单测**：第四位变化才换引用；三布尔不变 + count 不变时复用。
- **ThreadList 渲染测试**：`bg-running` class 分流优先级；徽标渲染与隐藏；蓝灯 + 徽标并存。
- **雷达 compose 单测**：仅后台任务运行（isProcessing=false, count>0）时 `threadIsProcessing` 为 true。
- **手工验收**（真机）：pi 会话 bg_run → 切走 → 紫灯 + 徽标；全部终态 → 灯灭 + 未读点；reduced-motion 开启降级静态。
