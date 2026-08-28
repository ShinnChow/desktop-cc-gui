# Tasks

## 1. TDD red

- [x] 1.1 `useMessagesRuntimeState`: running background tasks after foreground settlement derive `isBackgroundTaskAwaiting`.
- [x] 1.2 `WorkingIndicator` / timeline tail: awaiting state has visible count and continuation copy; foreground streaming takes precedence.

## 2. Presentation implementation

- [x] 2.1 Project `backgroundTaskRunningCount` through `ConversationState.meta` without modifying `isProcessing`.
- [x] 2.2 Add an explicit tail `background-awaiting` surface and pass state/count through Messages timeline models.

## 3. Terminal completion row（终态持久文案行）— 已废弃拆除

- [x] 3.1 ~TDD red / 3.2 kind 适配 / 3.3 双路合成 / 3.4 渲染~：2026-08-29 实机验收后按产品决策整体移除（幕布悬挂成排，聚合 + 折叠两轮优化仍不划算）。拆除清单见 design §5。

## 4. Review fixes（2026-08-29 边界 review 沉淀）

- [x] 4.1 `backgroundTaskStore` 终态口径统一：`countRunningBackgroundTasks` / `listBackgroundTaskRunningCounts` 复用 `isTerminalBackgroundTaskStatus`（原黑名单漏 `cancelled/canceled`，被取消任务 sidebar 紫点 / unread 永不收口）+ 回归测试。
- [x] 4.2 `backgroundTaskStore.ts` 源码字面 NUL 字节改为 `\u0000` 转义（git 不再把文件当 binary，diff 可读）。
- [x] 4.3 幕布标签补 count：原复用 sidebar 文案「后台任务运行中」（无 count 占位）违反 spec「正在等待 N 个」；改用新 key `messages.backgroundTaskAwaitingRunning` 并加 Messages 级断言锁住（并存场景 review 发现，2026-08-29）。
- [x] 4.4 registry watcher 终态口径统一：`TERMINAL` 补 `cancelled/canceled`（与 store 同款漏洞，registry metadata 取消终态会被当 running 永久探测）。
- [x] 4.5 watcher `deadSince` 改 workspace+thread+taskId 复合 key：不同会话 taskId 可能撞号，裸 key 互相重置「持续死亡」计时。
- [x] 4.6 幕布续接文案 i18n 落地：`backgroundTaskAwaitingContinuation` 原本所有 locale 都缺 key，非中文用户会看到中文 defaultValue；补 zh/en + 测试 mock。
- [x] 4.7 幕布计时器锚点入期待锁定：跟随实时 earliest 会让先完成任务后秒表倒退；改同一次等待期内锚点不变 + 回归测试。
- [x] 4.8 `removeThread` 清理后台任务状态表：原表无任何生产清理链，已删线程残留 running 记录会让 sidebar sync 向幽灵线程 dispatch、watcher 持续探测；reducer 内 queueMicrotask 清理（幂等，StrictMode 安全）。

## 5. Verify

- [x] 5.1 Run focused Vitest tests for runtime state, tail renderer, sidebar sync, store, parser, thread item events（8 suites / 118 tests 全绿）。
- [x] 5.2 Run `npm run typecheck`（仅剩分支存量 Sidebar.test / SettingsView.test 两个非本 change 错误）。
