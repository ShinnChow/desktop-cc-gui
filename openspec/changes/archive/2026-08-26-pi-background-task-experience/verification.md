# verification · pi-background-task-experience

> 2026-08-27 收口补充（L1 归档批次）。tasks 20 项全部闭合（`[x]`/`[~]`，`[~]` 为实现方式偏离记录）；本文件补齐 3.3 Render Perf 走查与 waiver 事实。

## 3.3 Render Perf 完整走查（2026-08-27）

对照基准：AGENTS.md「Render Perf Baseline」五条硬红线 + `docs/perf/render-jank-knife-experiments-2026-07-08.md` 四层根因。

| 红线 | 结论 | 证据 |
|---|---|---|
| ① 高频 setState 禁挂根 hook 链 | ✅ | `backgroundTaskStore.ts` 模块级事件驱动 store（`storeVersion` + listeners，`emitChange` 仅在 apply 时触发）；`src/app-shell/**` 对 `backgroundTaskStore` / `useBackgroundTaskPill` grep 零引用，消费者全部在 composer strip / message row 组件级 |
| ② 数组追加型 setState 禁入根链 | ✅ | store 数据结构为 per-`(workspaceId,threadId)`（`\x00` 复合键）map，按 `taskId` upsert 替换语义，非数组追加 |
| ③ 根链 store 事件驱动、禁秒级轮询 | ✅ | pill 走 `useSyncExternalStore`（版本号 snapshot，零轮询）；唯一 interval 是 `useBackgroundTaskRegistryWatcher` 的组件级 3s——「运行中有任务才计时、空闲即清、状态变了才 apply」，不挂根链（红线约束对象是根链 store 轮询；组件级受控探测的边界已在源码注释钉死） |
| ④ 流式正文走 liveAssistantTextChannel | 不适用 | bg 任务无正文流；更新为低频离散 `item/started` / `item/backgroundTask/updated` upsert |
| ⑤ 思考/工具输出走 liveItemDeltaChannel | 不适用 | 无高频工具输出 delta；receipt/notification 均为单事件 |

elapsed 活体：`BackgroundTaskCard.tsx` `useElapsedSeconds` 组件本地 `setInterval(1000)`，`active` 门控 + cleanup，组件 `memo`。四层根因（根链高频 dispatch / 数组追加 / 秒级根轮询 / 流式 delta 打根）均未命中。

## Waiver / 已知口径

- **post-settle orphan 通知**：per-turn forwarder 丢弃行为仍在；**根治路径按基石设计口径 = B 通道 registry watcher**（`useBackgroundTaskRegistryWatcher` 读 `.pi/tasks/` 终态 metadata），已落地并有测试。A 通道（resident 空闲期持续转发）不在本 change 范围，如未来做需单开 change。
- 3.2 的「顶栏入口与任务卡聚焦联动」未做（记录于 task，非 gate）。
- ADR 校准回写 Gate：canonical `backgroundTask` item 契约行已回写基石设计（task 4.1，commit `4b5f92bea`）。
