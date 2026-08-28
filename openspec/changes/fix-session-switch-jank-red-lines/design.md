# Design: fix-session-switch-jank-red-lines

按批次给出演练级设计。每批次独立可交付、可回滚，批次间无隐藏耦合。TDD 锚点测试先行。

## 批次划分与实施顺序

```
Batch 1  写盘旁路 + 肥 key 治理（F1/F2）     —— 纯数据层，风险最低，先拿确定性收益
Batch 2  worker error 探活 + errorName（F3） —— 独立小模块
Batch 3  resume hydrate 合批（F4）           —— threads hooks，中等风险
Batch 4  红线收窄 threadDataContext（F5）     —— app-shell 跨域重构，最高风险，走 Gate
```

顺序依据：1/2 与 3/4 无耦合；4 需要 1 先落（settingsContext 失效面收窄后，切会话写盘热点不再干扰 gate 观测）。

---

## Batch 1：写盘旁路 + 肥 key 治理

### F1a sidebarSnapshot 内容签名跳过

现状：`saveSidebarSnapshotThreads / saveSidebarSnapshotAllThreads / saveSidebarSnapshotWorkspaces / flushQueuedRemovals` 四条路径各自 `loadSidebarSnapshot()`（533 线程深度 normalize）+ `writeClientStoreValue`（无签名比对）。

设计：

- 新增模块内单一持久化入口 `persistSidebarSnapshot(next: SidebarSnapshot)`：
  - 维护 `lastPersistedSignatureRef: string | null`。首次调用时以 `getClientStoreSync("threads", "sidebarSnapshot")` 的**磁盘现值**初始化（处理进程重启后「内容已在盘上」的场景）；
  - 签名 = `hashStableString(JSON.stringify(next))`（复用 `fileMarkdownDocument.ts` 的 `hashStableString`，纯函数无依赖）；`updatedAt: Date.now()` 在签名计算**之后**再赋值，避免时间戳噪声制造假阳性；
  - 签名相同 → 跳过 `writeClientStoreValue`（连 normalize 后的 spread 也不再发生）。
- `saveSidebarSnapshotAllThreads` 增加**输入级 fast-path**：对入参 `threadsByWorkspace` 先算签名（≈170KB stringify，约 1ms），与上次成功保存的输入签名相同则整体早退——跳过 `loadSidebarSnapshot` 的全量深度 normalize。这是切会话场景的主要收益点：`useThreads.ts:704` effect 因无关 dispatch 换引用触发时直接零成本返回。
- 移除路径 `flushQueuedRemovals` 与 workspaces 路径统一走 `persistSidebarSnapshot`。
- 风险与对策：签名跳过若遇「外部直写该 key」会漏写——已核实该 key 全仓仅本模块写（proposal 依据），风险关闭；`clientStorage` 的 300ms debounce 与 no-op 跳过语义不变。

### F1b sessionRadar 去 immediate

`useSessionRadarFeed.ts:737-739 / :748-750 / :765-770` 三处 `writeClientStoreValue(..., { immediate: true })` → 移除 options，回归默认 300ms debounce。签名比对逻辑保留（它挡的是「内容没变还写」，debounce 挡的是「300ms 内多次写」）。已核实 `immediate` 在 `clientStorage` 的语义（`shouldDebounce` 分支），radar 三 key 无「必须立即落盘」的消费方（无跨窗口即时依赖，radar 面板读同一进程内 cache）。

### F2a sharedQueuedFollowUps 治理

- `writeSharedQueuedFollowUps`：去掉 `{ immediate: true }`。排队消息是用户显式低频动作，300ms debounce 足够。
- 写入时 prune：envelope key 为 `JSON.stringify([workspaceId, threadId])`；写入时对每个 key 校验 workspaceId ∈ 现存 workspaces、threadId ∈ 该 workspace 现存 threads（`getClientStoreSync("threads","sidebarSnapshot")` 提供存在性判定，避免全量 normalize——只需查 id 集合）；失效 key 直接 delete。
- 图片剥离：`normalizeQueuedMessage` 持久化分支对 `images` 数组求和（base64 长度），单条 >512KB（`MAX_PERSISTED_QUEUE_IMAGES_BYTES = 512 * 1024`）时剥离超限图片（按序保留未超限的），被剥离时 `console.warn` + `appendVolatileRendererDiagnostic("composer/queue-image-stripped")`。运行时内存中的队列不动（本轮发送不受影响），只约束落盘形态。
- 明确行为变化：**重载后**超限图片的排队消息不再保留图片（本轮发送前即剥的除外）。以 runtimeNotice 不引入新 UI，诊断可观测。

### F2b detachedSpecHubSession 指针化

现状 `DetachedSpecHubSession` 持久化 `files: FileNode[] + directories`（1.28MB）。设计：

- 持久化形状收敛为 `{ workspaceId, workspaceName, artifactType, changeId, specSourcePath, updatedAt }`；
- 恢复路径：读取指针后用既有 change 目录扫描 IPC 重建 `files/directories`（实现时确认既有加载函数；若 detached 窗口直接依赖持久化树，则在恢复时同步重扫一次，失败回退空树 + 诊断）；
- 写入侧：任何树更新只更新内存态，落盘仅指针（`updatedAt` 变化即触发一次指针写，不再全树 stringify）。
- 兼容：读取侧容忍旧格式（含 files 的存量）——直接丢弃 files/directories 字段按指针重扫，天然收敛，无需 migration。

### F2c turnFinalMeta 上限

`MAX_TURN_FINAL_META_THREADS` 500 → 200。`pruneTurnFinalMetaMap` 已按最旧线程先剪；新增测试断言 201 线程收敛到 200 且保留最新。

---

## Batch 2：worker error 探活 + errorName

现状：`handleWorkerError(event)` → `disposeBrokenWorker(error)` 无条件 terminate。

设计：

- `handleWorkerError` 改为：记录指纹（含新增 `errorName = event.error?.name ?? "Error"`）→ 发起**探活请求** `probeWorkerHealth()`：向 worker 发送固定小输入（`"# probe"`，requestId 前缀 `probe:`）+ 2s 短超时；
  - 探活成功（收到对应 result）：worker 存活，**不 dispose**；`workerDiagnostics.recordFallback("worker-error-kept-alive")` + volatile 诊断 `fast-markdown-worker/error-kept-alive`（含 errorName/hash/length）；连续 kept-alive 计数不清退避（后续真崩仍走既有退避）；
  - 探活失败 / 超时：走既有 `disposeBrokenWorker`（terminate + reject pending + 退避）。
- 探活请求不进 `pendingRequests` 主表（用独立 pending 槽），避免污染正常请求生命周期；探活期间到达的正常响应照常处理。
- 兜底不变：探活失败时 pending 的正常请求由 `rejectAllPendingRequests` 拒绝并走主线程 fallback；error 事件发生时在途正常请求若最终超时也走 fallback——两条路都保渲染正确性。
- 诊断：`fast-markdown-worker/failed` payload 增补 `errorName`（`event.error instanceof Error ? event.error.name : "Error"`）；`classifyFastMarkdownWorkerRuntimeError` 不变。

## Batch 3：resume hydrate 元数据合批

现状（`useThreadActionsResumeThread.ts:654-762`）：hydrate 完成段连续 dispatch `ensureThread → setThreadItems(首个 chunk) → setThreadPlan → setThreadHistoryRestoredAt → setThreadHistoryWindow → setThreadTokenUsage`，因 await 边界各自成 commit。

设计：

- reducer 新增组合 action `hydrateThreadHistorySnapshot`，payload：`{ workspaceId, threadId, items, plan, historyRestoredAtMs, historyWindow, tokenUsage }`（全部可选，除 identity 外）；单次状态转移内依序复用**既有**子逻辑（ensureThread 的行合并、setThreadItems 的 prepare/merge、plan/restoredAt/window/tokenUsage 的字段写入），保证与逐个 dispatch 的最终状态 bit 级一致——实现方式是把现有各 case 的纯函数体提取为 reducer 内共享函数，新旧 action 共用，杜绝双实现漂移。
- `hydrateHistorySnapshot` 调用点改为：单个 `dispatch({type:"hydrateThreadHistorySnapshot", ...})` 替代 5 次 dispatch；首个 items chunk（tail-first ≤300）与元数据同 action 落地。progressive 多 chunk 路径（>300）保持既有后续 chunk dispatch 不变（那是首屏窗口设计，非本 change 范围）。
- commit 预算：hydrate 段 = curtain 组（切前，已有）+ 数据+元数据组（1 commit）+ progressive 收尾（仅 >300 条会话）。单会话切入 hydrate 阶段根级 commit ≤3。
- 兼容：`ensureThread / setThreadPlan / ...` 既有 action 与调用方保留（resume 之外的路径仍在用）；仅 resume 链切换到组合 action。
- 风险：claude token 回填等条件分支（`:500-506`）必须跟随进 payload 的可选字段；错误恢复路径（`setThreadHistoryRecoveryFailed`）不合并（低频且语义独立）。

## Batch 4：红线收窄 threadDataContext

红线：`threadsByWorkspace / threadStatusById / threadItemsByThread / threadListLoadingByWorkspace`（含 history* 投影）禁止被 `sections / render / layoutNodesChrome` 无差别订阅。

现状：四 key 在 `settingsContext`（`appShellDomainContexts.ts:628-631`），而 `APP_SHELL_CONSUMER_DOMAIN_SELECTION` 的 `layoutNodes / layoutNodesChrome / sections / render` 四个消费集都含 `settingsContext` → 任一线程 dispatch 四个 bag 全失效。

设计：

- 新增 domain `threadDataContext`（`APP_SHELL_DOMAIN_CONTEXT_NAMES` 第 15 个），owner：`buildThreadDataDomainContextSlice`（`useAppShellDomainAssembly.ts` 新 builder）+ runtime thread host（写权唯一，符合「写权单一」矩阵原则）。
- key 迁移：上述四 key（+ 若 §3.4 簇中 `history*` 投影同属全量 map 语义则一并）从 settingsContext 迁出；settingsContext 剩余 keys（settings UI / terminal / radar UI 态 / skills 启动器）语义保持。
- 消费集收敛：
  - `sections / render / layoutNodesChrome` 的选择集**不包含** `threadDataContext`；
  - 实际消费方逐一改窄通道：
    - sidebar 线程列表 / topbar tabs：`layoutNodes` 消费集**保留** threadDataContext（它们是真消费者），但 sidebar 行数据已经过 `useSidebarThreadStatusProjection` 布尔投影，`Sidebar` memo 面不扩散；
    - quick switcher / radar / search 面板：经各自 section 的**字段级**选择读取（`selectAppShellDomainBag` 已支持 selected-field helper；若无则新增 `selectAppShellDomainFields`）；
    - composer：仅读 activeThreadId（已在 sessionIdentityContext）与自身窄信号，迁移后不订阅 threadDataContext；
  - 迁移中发现的「sections/render 实际读取了 thread map 字段」的隐性消费点：逐点处理——能改投影的改投影（布尔/计数），真需要全量的显式声明消费 threadDataContext（此时该点成为记录在案的窄消费者，而不是域泄漏）。
- 可执行 gate（TDD 锚点）：`appShellDomainOwnershipGate.test.ts` 或新增 `threadDataSubscriptionRedLine.test.ts` 断言：
  1. `APP_SHELL_CONSUMER_DOMAIN_SELECTION.sections / render / layoutNodesChrome` 不含 `"threadDataContext"`；
  2. 这些消费集的 bag 构建结果（`selectAppShellDomainBag` 输出）不含上述四 key；
  3. owner map 完整性测试对迁移后 key 集合仍全绿（`APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS` 同步更新）。
- Governance：`npm run check:app-shell:governance` 必须全绿（owner map 完整 / 无重复 owner / freeze 表 key 数：settingsContext 36 → 减 4~6，threadDataContext 起步 ≈4~6，远低于 soft 80；navigation hard ≤79 不受影响）。
- 预期收益量化：切会话 `setActiveThreadId` 与任何线程 dispatch 的 bag 失效面从 4 个消费集收敛到 1 个（layoutNodes）+ 显式窄消费者；`AppShellView` 三 section 中 sections/render 不再因线程态整体重跑。

## 测量与验收口径

- 每批次 TDD：先写红测试（断言新契约），实现后转绿；红测试必须先在现实现上跑出失败。
- Batch 4 后用设置页「最近卡顿（实时）」做真机对照：清空 → 快速连续切 5 个会话 → 对照本次基线（11:14 段：313/338ms、~70 updates）观察单 commit update 数与耗时；该复验记入 tasks 收口项（对应前 change 4.4 的复验方法）。
