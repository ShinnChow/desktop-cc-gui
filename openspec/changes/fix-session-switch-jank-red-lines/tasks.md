# Tasks: fix-session-switch-jank-red-lines

按批次 TDD（先红后绿），每批次结束跑验证并 commit（中文 Conventional Commits），供按批次 review。

## Batch 1 写盘旁路 + 肥 key 治理（F1/F2）

- [x] 1.1 红测试（F1a）：`sidebarSnapshot.test.ts` 新增——内容未变的 `threadsByWorkspace` 二次调用 `saveSidebarSnapshotAllThreads` 时 `writeClientStoreValue` 不被调用；`loadSidebarSnapshot` 不被再次调用（输入级 fast-path）；内容变化时正常写。现实现下先跑红。
- [x] 1.2 实现（F1a）：`sidebarSnapshot.ts` 收敛 `persistSidebarSnapshot` + `lastPersistedSignatureRef`（磁盘现值初始化）+ 输入级签名 fast-path；四条写路径统一走入口；`updatedAt` 在签名后赋值。
- [x] 1.3 红测试（F1b）：`useSessionRadarFeed` 相关测试断言持久化调用不含 `immediate: true`（现实现红）。
- [x] 1.4 实现（F1b）：`useSessionRadarFeed.ts` 三处持久化去 `immediate`，保留签名比对。
- [x] 1.5 红测试（F2a）：`sharedQueuedFollowUpStore.test.ts` 新增——写入不传 immediate；失效 workspace/thread 的队列被 prune；单条图片 base64 >512KB 被剥离 + 诊断记录；512KB 内图片保留。
- [x] 1.6 实现（F2a）：`sharedQueuedFollowUpStore.ts` 去 immediate + prune + `MAX_PERSISTED_QUEUE_IMAGES_BYTES` 剥离。
- [x] 1.7 红测试（F2b）：`detachedSpecHub.test.ts` 新增——持久化载荷仅含指针字段（无 `files`/`directories`）；旧格式存量读取按指针重扫不崩。
- [x] 1.8 实现（F2b）：`detachedSpecHub.ts` 持久化指针化 + 恢复重扫。
- [x] 1.9 红测试（F2c）：`turnFinalMetaStorage.test.ts`——201 线程收敛到 `MAX_TURN_FINAL_META_THREADS`（200）且保留最新；现值 500 下该测试红。
- [x] 1.10 实现（F2c）：`turnFinalMetaStorage.ts` 上限 200。
- [x] 1.11 Batch 1 验证：相关 vitest 全绿；`npm run typecheck` 0 error；`git diff --stat` 无格式化噪音；commit `fix(perf): 切会话写盘旁路——sidebarSnapshot 签名跳过、radar 去 immediate、肥 key 治理`。

## Batch 2 worker error 探活 + errorName（F3）

- [x] 2.1 红测试：`workerAdapterCrashBackoff.test.ts` 新增——error 事件后探活成功路径不 dispose（后续请求仍走 worker）、记录 `worker-error-kept-alive`；探活失败路径 dispose + 既有退避；诊断 payload 含 `errorName`。现实现下红。
- [x] 2.2 实现：`workerAdapter.ts` 探活槽（独立 pending，2s 超时）+ `handleWorkerError` 探活分支 + `errorName` 指纹。
- [x] 2.3 Batch 2 验证：fastMarkdownRenderer 相关面全绿；typecheck；commit `fix(markdown): worker error 事件先探活再处决并落 errorName 指纹`。

## Batch 3 resume hydrate 合批（F4）

- [x] 3.1 红测试（reducer）：`useThreadsReducer.test.ts` 新增 `hydrateThreadHistorySnapshot`——单 action 一次转移覆盖 ensure + items + plan + restoredAt + window + tokenUsage；与逐个 dispatch 的终态 deep-equal。
- [x] 3.2 红测试（hook）：resume 链测试断言 hydrate 段 dispatch 计数 ≤3（现实现红）。
- [x] 3.3 实现：reducer 提取共享纯函数 + 新 action；`useThreadActionsResumeThread.ts` hydrate 段切组合 action（claude token 回填条件分支随 payload 可选字段）。
- [x] 3.4 Batch 3 验证：threads resume / reducer 相关面全绿；typecheck；commit `perf(threads): 会话 hydrate 元数据合批，根级 commit 收敛到 ≤3`。

## Batch 4 红线收窄 threadDataContext（F5，AppShell Structure Gate）

- [x] 4.1 前置：按 Gate 读 `docs/plans/2026-08-11-app-shell-cohesion-optimization.md` 与 ownership matrix，列出 `settingsContext` 四 key 的全部真实消费点清单（grep + bag 消费面核对），标注每点处理方式（迁移 / 投影化 / 显式窄消费）。
- [x] 4.2 红测试（gate）：新增 `threadDataSubscriptionRedLine.test.ts`——四 key 归属 `threadDataContext` 且不在 settingsContext；`layoutNodesChrome` 选择集不含该域；sections/render 显式消费记录在案（防无差别回流）。现实现下红。
- [x] 4.3 实现：新增 `threadDataContext` + `buildThreadDataDomainContextSlice` + owner map 更新；四 key 迁出 settingsContext；`layoutNodesCanvas` 承接侧栏数据供应（chrome zone 与线程 dispatch 解耦）；`APP_SHELL_CONSUMER_DOMAIN_SELECTION` 更新；freeze 表 settingsContext 36→32 / threadDataContext 4 咬死。
- [x] 4.4 验证：`npm run check:app-shell:governance` 22/22 全绿；app-shell 失败集合与 HEAD 基线完全一致（全部存量）；typecheck 0；commit `refactor(app-shell): threads 全量 map 收窄进 threadDataContext，红线落可执行 gate`。
- [ ] 4.5 真机对照复验（发版前）：设置页清空「最近卡顿」→ 连续快速切换 5 个会话 → 单 commit update 数与耗时对照 2026-08-28 基线（313/338ms、~70 updates），结果记录到本 tasks 下。

## 4b 后续批次（深化收窄，收口前评估）

- [ ] 4b.1 `render`：Settings 的 `workspaceThreadsById` / `workspaceThreadListLoadingById` 改由 settings surface 窄通道供给，`render` 选择集移出 `threadDataContext`（红线 gate 同步更新）。
- [ ] 4b.2 `sections`：flows/searchRadar/quickSwitcher 按消费点改布尔/计数投影或字段级选择，逐点移出并更新红线 gate 显式消费清单。

## 收口

- [x] 5.1 `openspec validate fix-session-switch-jank-red-lines --strict --no-interactive` 通过；`openspec/changes/README.md` 索引更新。
- [ ] 5.2 全部批次 `git log` review：每批次独立 commit、diff 限于本 change hunk、无全文件重排（4 批次 commit 后核对）。
