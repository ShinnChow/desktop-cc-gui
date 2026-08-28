# Change: fix-session-switch-jank-red-lines

## Why

本机实测（2026-08-28，生产构建，`~/.ccgui/client/diagnostics.json` 持久化 26 条 severe 掉帧 + 设置页「最近卡顿（实时）」volatile 200 条 + error-log）抓到三类问题，用户体感为「频繁切换 session 时带来几秒卡顿、空闲期每分钟卡一下」。全部根因已代码核实，且分别命中**既有红线**或**既有 change 明确留白的 Non-Goal**：

### 1. 切会话渲染扇出（命中 ownership matrix 性能红线）

掉帧现场：切会话瞬间单次 React commit **187~297ms / ~70 updates**（11:14:15.846 / 11:14:16.404 两条，伴随 `leida:sessionRadar.recentCompleted` 与 `threads:sidebarSnapshot` 写盘热点）。代码链核实：

- `useThreads` 单一 reducer（`src/features/threads/hooks/useThreads.ts:253`）持有 17 类线程态，每次 dispatch 顶层 `{...state}` 换引用；
- 根 host（`src/app-shell/hosts/useAppShellRuntimeThreadHost.ts:59` 唯一实例化点）把 ~130 字段整体 publish 到 host bus（`appShellHostBus.tsx:194-204`）；
- Assembly host 订阅**全量** `RUNTIME_FIELDS`（`appShellAssemblyHostFields.ts:367-448`）；
- `threadsByWorkspace / threadStatusById / threadItemsByThread / threadListLoadingByWorkspace` 归属 `settingsContext`（`appShellDomainContexts.ts:628-631`），而 `settingsContext` 被 `layoutNodes / layoutNodesChrome / sections / render` **四个消费集**无差别选择（`APP_SHELL_CONSUMER_DOMAIN_SELECTION`，`appShellDomainContexts.ts:706-768`）→ 任一线程 dispatch 使四个 bag 全部失效重建；
- `AppShellView`（`appShellView.tsx:16-42`）单函数组件聚合 search/sections/layoutNodes 三个 section hook → 全量重跑。

**红线原文**：`docs/plans/app-shell-ownership-matrix.md:96`（settingsContext 行）与 `:181`（§3.4 Threads 投影行）——「threads 全量 map **禁止**进 left/right 无差别订阅（性能红线）」「全量 status/items 不得无差别进 left/right」。现状即违规态。

### 2. 切会话写盘放大与 resume 链多次 commit

- `useThreads.ts:704-706` effect 对 `threadsByWorkspace` 任何引用变化执行 `saveSidebarSnapshotAllThreads`：读全量快照（当前 533 线程 / 173KB 序列化）深度 normalize → spread → 整键 stringify → patch IPC；**无内容签名比对**，内容未变也写。`threads.json` 已 955KB，Rust 侧每次 flush 是带文件锁的 read-modify-write + fsync 原子写。
- `useSessionRadarFeed.ts:710-773` 持久化 effect 每次 `mergedRecentFeed` 重建都要 stringify 全量 200 条（66KB）做签名比对，签名变化时以 **`{ immediate: true }` 绕过 300ms debounce** 连写 2~3 个 key（recentCompleted / readState / dismissed）——首切新会话时 preview 变化必然触发。
- resume 链（`useThreadActionsResumeThread.ts:654-762`）`ensureThread → setThreadItems → setThreadPlan → setThreadHistoryRestoredAt → setThreadHistoryWindow → setThreadTokenUsage` 共 6+ 次 dispatch，中间被 `await` / `setTimeout(24ms)` 边界隔开，React automatic batching 无效，每次都是一次全树根级 commit。

### 3. 存量肥 key（前 change `fix-client-store-ipc-jank-and-markdown-worker-churn` Non-Goal 明确留白「数据治理另开 change」）

| key | 实测体积 | 内容 | 写入特征 |
| --- | --- | --- | --- |
| `composer.sharedQueuedFollowUps.v1` | **2.45MB** | 5 条排队消息，其中 **2 张历史截图 base64 占满全部体积**（1.76MB + 688KB），3 条已空队列 key 残留 | `writeSharedQueuedFollowUps` 以 `immediate: true` 全量 stringify |
| `app.detachedSpecHubSession` | **1.28MB** | spec-hub 窗口**整棵文件树**（files 893KB + directories 388KB）——可随时从磁盘重扫的派生数据 | 每次树更新全量写 |
| `threads.turnFinalMeta` | **633KB** | 500 线程 × 每条 7 个数字字段，按 `MAX_TURN_FINAL_META_THREADS = 500` 上限堆满 | 每次 turn 结束全 map 写（debounce 300ms） |

这些 key 一旦变脏，flush 时同步 stringify 全键（O(len)，2.45MB 为毫秒到数十毫秒级主线程税），并放大 Rust 侧磁盘写。

### 4. fast-markdown-worker「error 事件即处决」+ 指纹不可归因

当天 4 次 `fast-markdown-worker/failed`（`errorClass: worker-uncaught`，**同一指纹** `messageHash: 1wt84ny` / `messageLength: 45`，09:59 / 10:28 / 11:16 / 11:18）。前 change F2 已落地负缓存 + 指数退避 + messageHash 指纹，但代码核实仍有两个缺口：

- `workerAdapter.ts handleWorkerError` 收到 worker `error` 事件即 `disposeBrokenWorker`（terminate + 置空 + 拒绝全部 pending）。而引擎语义上 worker 遇到未捕获异常**并不终止**，`error` 事件≠worker 已死；编译请求路径本身有 `.catch` 保护（`fastMarkdown.worker.ts:48-55`），能触发 error 事件的只有引擎级未捕获异常或脚本加载失败——一律处决会制造「同一错误 → 杀 → 重建 → 同一错误」循环（当天 4 次 × 每次重建往返 88–325ms）。
- 诊断只落 `messageHash`（错误文本的哈希），无 `errorName`，事后无法区分 TypeError / RangeError / 加载失败，不可归因。

## What Changes

- **F1 写盘旁路**：sidebarSnapshot 三处写入收敛到单一持久化入口并加**内容签名跳过**（输入 `threadsByWorkspace` 级 fast-path + 快照级 no-op skip）；`useSessionRadarFeed` 三处 `{ immediate: true }` 移除，回归 clientStorage 默认 300ms debounce 合并。
- **F2 存量肥 key 治理**：
  - `sharedQueuedFollowUps.v1`：去掉 `immediate`；写入时 prune 已失效队列（workspace 不存在 / thread 不存在）；单条排队消息图片 base64 总量超阈值（512KB）时剥离图片再入库 + `runtimeNotice` 诊断；
  - `detachedSpecHubSession`：持久化收敛为**指针字段**（workspaceId / workspaceName / artifactType / changeId / specSourcePath / updatedAt），`files` / `directories` 不再持久化，恢复时按 changeId 重扫；
  - `turnFinalMeta`：`MAX_TURN_FINAL_META_THREADS` 500 → 200（先剪最旧机制已有）。
- **F3 worker error 探活 + errorName 指纹**：`error` 事件先发一个极小探活编译请求（短超时），探活成功则不 dispose（记录 `worker-error-kept-alive` + errorName 诊断），失败才 dispose；`fast-markdown-worker/failed` payload 增补 `errorName`。
- **F4 resume 链 hydrate 元数据合批**：新增组合 reducer action（`hydrateThreadHistorySnapshot`）一次性落 `ensureThread + setThreadPlan + setThreadHistoryRestoredAt + setThreadHistoryWindow + setThreadTokenUsage`，与首个 items dispatch 同段执行；hydrate 相关 commit 从 6+ 收敛到 ≤3（curtain / 首个数据+元数据 / 收尾）。
- **F5 红线收窄（AppShell Structure Gate 管辖）**：`threadsByWorkspace / threadStatusById / threadItemsByThread / threadListLoadingByWorkspace` 移出 `settingsContext`，归入新 **`threadDataContext`**（owner：`buildThreadDataDomainContextSlice` + runtime thread host）；`sections / render / layoutNodesChrome` 消费集不再无差别持有该域，仅实际需要的消费面（sidebar/topbar 投影、quick switcher、radar）经**字段级窄选择**订阅；新增可执行红线 gate 测试锁死「全量 thread map 不得出现在 left/right 无差别消费集」。

## Capabilities

### Modified Capabilities

- `client-storage-performance`：
  - ADDED requirement「snapshot 类派生 key 写入 MUST 内容签名跳过」；
  - ADDED requirement「client store key 体积预算与存量治理」——`sharedQueuedFollowUps.v1` / `detachedSpecHubSession` / `turnFinalMeta` 的体积上限、失效 prune、图片剥离契约；
  - MODIFIED requirement「高频写入源节流」——immediate 写仅限用户显式动作回响（当前仅 ice-break 等枚举），radar / queued follow-ups 持久化 MUST 走默认 debounce。
- `markdown-parse-pipeline`：
  - ADDED requirement「Worker Error Event MUST Be Health-Probed Before Dispose」；
  - MODIFIED requirement「Markdown Worker Requests MUST Have Bounded Lifecycle Diagnostics」——崩溃诊断 MUST 携带 `errorName`。
- `app-shell-domain-context-isolation`：
  - ADDED requirement「Thread Full Maps MUST NOT Be Indiscriminately Subscribed By Left/Right Consumer Sets」——把 ownership matrix 红线升级为可执行 gate。
- `codex-chat-canvas-workspace-session-activity-panel`：
  - ADDED requirement「Radar Persistence Writes MUST Be Debounced」——radar 三类 key 持久化 MUST 走默认 debounce，MUST NOT 以 immediate 绕过。

### Added Capabilities

- `thread-history-hydration-render-budget`：会话历史 hydrate 链的 commit 预算契约（单会话切入 hydrate 阶段根级 commit 数 ≤3；元数据 MUST 与首个数据 dispatch 合批）。

## Non-Goals

- **不恢复 timeline 虚拟化**：2026-08-08 `347cb8ee4` 有意移除（估高回填 / stick-to-bottom 跳底换稳定滚动，净 -6282 行），tail-first 窗口（首屏 ≤300 条）是现行方案；重引入属产品级决策，另立 change。
- **不动 60s git 轮询**：`useGitStatus` 有等值守卫，多 AI 并行开发下状态真变化属预期信号；若实测仍构成背景税，另立 change 收窄订阅面。
- **不改 diagnostics 脱敏策略本体**（error 完整文本仍只进 console）。
- **不做 `composer.json` / `app.json` key 拆分**与全 store 重新分库。
- **不改 resume 的 tail-first 首屏窗口语义**（≤300 条首屏、500/页 prepend 保持不变）。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Frontend 数据层 | `sidebarSnapshot.ts` / `useSessionRadarFeed.ts` / `sharedQueuedFollowUpStore.ts` / `detachedSpecHub.ts` / `turnFinalMetaStorage.ts` |
| Frontend markdown | `fastMarkdownRenderer/workerAdapter.ts` |
| Frontend threads | `useThreadsReducer.ts` / `useThreadActionsResumeThread.ts` / `useThreads.ts` |
| AppShell | `appShellDomainContexts.ts` / `useAppShellDomainAssembly.ts` / 相关 section 消费面 + governance gate 测试 |
| 热路径收益 | 切会话：少 2 次 immediate 全量写 + hydrate 元数据合批 + settingsContext 失效面收窄（预期四个 bag 失效 → 1~2 个）；空闲期：无内容变化的 sidebarSnapshot effect 不再触发 stringify + patch + Rust 原子写 |
| 风险 | F5 为跨域重构，须按 AppShell Structure Gate 走 ownership matrix / governance gate；F2 图片剥离改变「重载后大图排队消息保留完整图」的既有行为（以 runtimeNotice 告知）；F4 改 reducer action 面，须保证旧 dispatch 路径兼容 |
| 验证方式 | TDD 先红后绿；`vitest` 相关面 + `npm run check:app-shell:governance` + `npm run typecheck`；每批次 `git diff --stat` 自查无格式化噪音 |

## Acceptance

- **A1（F1）**：内容未变的 `threadsByWorkspace` 触发 `saveSidebarSnapshotAllThreads` 时，`writeClientStoreValue` 不被调用、快照不被 normalize（以 spy 断言）；内容变化时正常写入。radar 持久化调用不再传 `immediate: true`。
- **A2（F2）**：`writeSharedQueuedFollowUps` 走 debounce；workspace 已不存在的队列在写入时被 prune；单条消息图片 base64 合计 >512KB 时图片被剥离且 envelope 体积受控。`detachedSpecHubSession` 持久化载荷仅含指针字段（无 `files`/`directories`）。`MAX_TURN_FINAL_META_THREADS = 200` 且存量收敛有测试。
- **A3（F3）**：worker 收到 error 事件后，探活成功路径不 dispose（后续请求仍走 worker）；探活失败路径按既有退避 dispose；诊断 payload 含 `errorName`。
- **A4（F4）**：hydrate 完成段单次 dispatch 携带 items+plan+restoredAt+window+tokenUsage，reducer 单次转移全部生效；resume 链 hook 测试断言 hydrate 段 dispatch 计数 ≤ 约定值。
- **A5（F5）**：红线 gate 测试断言 `threadsByWorkspace/threadStatusById/threadItemsByThread/threadListLoadingByWorkspace` 不出现在 `sections/render/layoutNodesChrome` 消费 bag 可达字段中；`npm run check:app-shell:governance` 全绿；owner map 完整性测试通过。
- **A6（回归）**：本 change 触及的既有测试面全绿（clientStorage / rendererDiagnostics / sessionRadar / threads resume / app-shell governance）；`npm run typecheck` 0 error；改动文件过 prettier 局部纪律（只动本次 hunk）。
