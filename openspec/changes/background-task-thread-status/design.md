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
- **D8 第四态位置在右侧 meta 区（2026-08-27 真机验收反馈修订）**：紫呼吸点与计数徽标渲染在会话行右侧 meta 区（`thread-runtime-dot--bg-running` + `thread-bg-task-count`），左侧 `thread-status` 保持原有四态不动。初版曾把 `bg-running` 插进左侧 statusClass 分流，真机看到后用户拍板改右侧——左侧点紧贴缩进/引擎徽标视觉拥挤，且右侧本就是「运行态」语义位（processing/reviewing/completed dot 所在）。
- **D9 status 写点必须保留 backgroundTaskRunningCount（2026-08-27 真机事故修复）**：`markProcessing`（true/false 两分支）与 `markContextCompacting` 是显式逐字段枚举重建 status，不含新字段——turn settle 的一次 `markProcessing(false)` 就把计数抹掉，且 store 无新事件时 sync 不会补发，紫灯永久熄灭（真机复现：pill 2/4 亮着、行上无灯无徽标、时间照常显示）。三处写点已补 `backgroundTaskRunningCount: previous?.backgroundTaskRunningCount ?? 0`，并以回归测试锁定（markProcessing / markContextCompacting 往返保留计数）。审计结论：其余写点走 `withThreadStatusDefaults` 或 `...previous` 展开，天然保留。
- **D10 registry watcher 上收 app 级（2026-08-28 真机事故修复，8-26 提案 P2 缺陷修订）**：原 watcher 挂在 `ComposerRunStatusStrip`、scope 只有当前活跃会话——用户切走会话后原会话的 running 任务无人探测；且 post-settle 通知被 orphan run per-turn forwarder 天然丢弃（8-26 设计 §实现校准），registry watcher 是唯一 live 兜底。结果终态只进 store（pill/panel 显示已完成），时间线卡片永停「运行中」，重开历史才正确（piHistoryParser 把终态写进 output JSON，而卡片读数恰是 `parseBackgroundTaskSnapshot(output)` 且 task.status 优先于 item.status）。修复：抽 `probeThreadTasks` 复用探测逻辑，新增 `useBackgroundTaskRegistryWatcherForRunningThreads` 挂 `useThreadEventHandlers`（与 sink 注册同层，sink 必在 → 走 sink 全路径回写 store + 时间线 + pill + 呼吸灯），每 tick 枚举 `listBackgroundTaskRunningCounts()` 的 running>0 会话逐个 probe；strip 上的旧挂载移除（避免双 probe）。probe 的 readFile catch 增加 DEV console.warn 可观测性。
- **D11 backgroundTask 终态更新绕过 turn 终态守卫（2026-08-28 真机事故真根因，D10 的前置遗漏）**：D10 上收 watcher 后真机仍复现——真正根因在 `handleItemUpdate` 入口的 `isRealtimeTurnTerminal` 守卫（`useThreadItemEvents.ts:1606`）：合成 backgroundTask item 无 turnId → 命中「无 id 分支」，而 post-settle 线程已被 `markRealtimeTurnTerminal` 登记进 `settledRealtimeThreadsRef` → 合法终态更新被当「迟到事件」静默丢弃。store 之所以始终正确：`applyBackgroundTaskUpdate`（store 合并）在守卫**之前**执行，一条语句之隔——pill/panel 对、时间线卡不动。该守卫本意是防迟到事件把已结算回合复燃成「生成中」，backgroundTask 合成 item 不带 markProcessing 语义、不会复燃，属误伤。修复：`handleItemUpdate` 增加 `options.skipTurnTerminalGuard`，`onBackgroundTaskUpdated` 传入。回归测试锁定：settled 线程上普通 item 仍被丢（守卫本意不破坏）、backgroundTask 终态 upsert 放行（stash 验证红灯 `expected undefined to be truthy` → 修复后绿）。
- **D12 绕过守卫必须同时关掉 markProcessing（2026-08-28 真机回归，D11 的伴随修正）**：D11 初版沿用了旧调用的 `shouldMarkProcessing=true`——修复前该参数无害恰因守卫把整个调用丢弃；绕过守卫后 `markProcessing(threadId, true)` 真实执行，post-settle 后无 turn 再发 false → 会话永久「响应中…」、composer 停止按钮常驻、sidebar 行 processing 蓝灯压过 bg-running 紫灯（正是守卫注释要防的「复燃」，只是这次是修复自己引入的）。修正：`onBackgroundTaskUpdated` 改传 `shouldMarkProcessing=false`；回归断言 `markProcessing not called with (threadId, true)`（stash 红灯 `expected "spy" to not be called` → 修复后绿）。教训：绕过一个守卫时，必须重审同一调用里原本被守卫「顺手挡掉」的所有副作用。

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

左侧 `thread-status` 点：保持原有四态分流不变（reviewing > processing > unread > ready）。

右侧 meta 区运行状态点（`runtimeIndicator` → `thread-runtime-dot--*`）分流（优先级从高到低，D8）：

```
isReviewing        → reviewing（静浅蓝，不变）
isProcessing       → processing（蓝呼吸，不变）
bgCount > 0        → bg-running（紫呼吸，新）
hasUnread          → completed（静绿，不变）
```

- 徽标：紫点前渲染 `<span className="thread-bg-task-count">{count}</span>`，`count > 0` 即显示，与运行点颜色分流解耦（D5）；蓝灯（processing）+ 徽标并存。
- CSS：`.thread-runtime-dot--bg-running { background: #a55eea; box-shadow: 同款 halo; animation: sidebar-thread-status-breathe 1.8s ease-in-out infinite; }` + `.thread-bg-task-count` 徽标样式（均含 light 主题变体）；`prefers-reduced-motion` 覆盖 `.thread-runtime-dot--bg-running { animation: none; }`。
- `runtimeIndicator` label 分支补 `bg-running`（tooltip 文案「后台任务运行中」，i18n key `threads.runtimeBackgroundTasks`）。

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
