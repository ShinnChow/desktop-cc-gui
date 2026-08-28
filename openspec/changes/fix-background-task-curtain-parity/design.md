# Design: fix-background-task-curtain-parity

## 1. Presentation state machine

```text
foreground-streaming
  -- foreground settles while backgroundTaskRunningCount > 0 -->
background-awaiting
  -- new foreground stream ingress / isThinking=true --> foreground-streaming
  -- running count becomes 0 without new stream --> settled
```

`background-awaiting` 是 conversation presentation state，不是 `isProcessing` mutation。`isProcessing` 仍只描述 foreground turn，避免 Composer 被错误禁用、stop 绑定到不存在的主回合、stream-only perf branch 被错误触发。

## 2. Data flow

### 2.1 Live-store ownership

`MessagesCore` SHALL use `useBackgroundTaskRunningSnapshot(workspaceId, threadId)` to subscribe directly to `backgroundTaskStore`, the same event-driven source used by the sidebar and composer task pill. `ConversationState.meta.backgroundTaskRunningCount` remains an optional layout projection, but MUST NOT be the sole source for the main conversation curtain: active-canvas snapshots can retain an earlier value after a foreground turn settles.

This direct `useSyncExternalStore` read is event-driven (no polling) and scoped to the currently rendered conversation, so it does not put task updates onto the AppShell root render chain.

```text
backgroundTaskStore
  -> threadBackgroundTaskStatusSync
  -> ThreadActivityStatus.backgroundTaskRunningCount
  -> ConversationState.meta.backgroundTaskRunningCount
  -> useMessagesRuntimeState.isBackgroundTaskAwaiting
  -> Timeline tail awaiting curtain
```

Running 判定双口径（review 后统一）：

- curtain（`useBackgroundTaskRunningSnapshot`）：白名单 `running/pending/queued/starting`——未知状态不吊住幕布，避免异常快照让等待态永不收口。
- sidebar / pill sync（`listBackgroundTaskRunningCounts` / `countRunningBackgroundTasks`）：`!isTerminalBackgroundTaskStatus` 黑名单。2026-08-29 review 修复：原黑名单漏掉 `cancelled/canceled`，被取消任务会让 sidebar 紫点 / unread 永不收口；现已与 `isTerminalBackgroundTaskStatus` 完全同口径。

## 3. Rendering contract

- `isBackgroundTaskAwaiting = !isThinking && backgroundTaskRunningCount > 0`。
- Tail curtain MUST be a distinct visible component, with count and explicit continuation copy（「正在等待 N 个后台任务完成」+「任务完成后主对话将自动继续」）; it MUST NOT be an empty reserved row or a generic spinner with no semantic text.
- New `isThinking=true` hides the awaiting curtain and returns to standard streaming `WorkingIndicator` / assistant rows.
- A count transition to zero removes the awaiting curtain. Sidebar count/dot and task card lifecycle remain owned by existing code.

## 4. Tests

1. runtime selector: foreground settled + count 2 produces awaiting state and label.
2. renderer: awaiting state renders visible tail copy/count.
3. transition: stream ingress (`isThinking=true`) removes awaiting curtain and shows normal stream path.
4. count 0 does not render awaiting surface.
5. 非 pi 引擎不产生 awaiting curtain（`enabled: engine === "pi"` 门控）。
6. cancelled 终态后 sidebar running 计数归零。

## 5. Removed: terminal completion row（终态留痕行，已废弃）

2026-08-29 复盘决策：终态持久文案行（`backgroundTaskCompletion` kind，实时 notification 合成 + 历史 parser 派生 + 展示层聚合 + 过程折叠参与）实现并试运行后**整体移除**。

- 废弃原因：多任务并行时幕布悬挂成排分隔行，聚合（1 行 + 数量 + 结束时间）与折叠（进「已处理」chip）两轮优化后仍不划算；终态事实已由任务卡翻态 + sidebar/pill 收口承载。
- 拆除面：`ConversationItem` kind、`buildConversationItem` 分支、`scrollKeyForItems` / `NORMALIZED_ITEM_KINDS` / stream fingerprint 适配、store `completionItem` 合成、`useThreadItemEvents` 派发、`piHistoryParser` 历史派生、`BackgroundTaskCompletionRow` + 渲染分支 + CSS + i18n、聚合 util。
- 保留面：`background-awaiting` 幕布（本 change 主需求）、store 终态口径统一、NUL 字节转义修复。
- 教训沉淀：给幕布加「非模型产物系统行」前，先用真机多任务并行场景验收视觉密度；低价值高频行宁可不进幕布。
