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

实施中核实（修正立项时假设）：React 18 automatic batching 下，`applyHydratedItems` 的 items dispatch 与其后微任务里的 metadata dispatch 本就同宏任务 → 已合为一次 commit。真正多付的是 **curtain paint yield 之前的 `ensureThread` 独立 dispatch**——它让侧栏/全树在还只显示 curtain 时就多付一次根级 commit。

实际落地：

- reducer 新增组合 action `hydrateThreadHistorySnapshot`（payload：ensureThread 字段 + plan + historyRestoredAtMs + historyWindow + tokenUsage 可选），case 内**递归调用 `threadReducer` 依序应用既有子 case**——构造上保证与逐个 dispatch 终态 bit 级一致，零逻辑复制。
- `hydrateHistorySnapshot` 调用点：移除 yield 前的 `ensureThread` dispatch；`applyHydratedItems`（items）之后以组合 action 一次落 ensure + plan + restoredAt + window + tokenUsage——与 items dispatch 同宏任务 → 同一次根级 commit。
- hydrate 段 commit 预算：curtain 组（recovery/progress，挂独立 historyLoading state）+ 数据+元数据组 = **2 次**（≤3 达标）；claude/gemini 恢复路径本就同宏任务合批，不动。
- 测试锚点：`useThreadsReducer.hydrateComposite.test.ts`（4 测：字段覆盖 / 与细粒度路径 deep-equal / 可选字段 / null plan 语义）+ `useThreadActions.test.tsx` 两用例更新为新契约（ensure 经组合 action 落库）。

## Batch 4：红线收窄 threadDataContext

红线：`threadsByWorkspace / threadStatusById / threadItemsByThread / threadListLoadingByWorkspace` 禁止被 left/right 无差别订阅。

现状核实（实施前消费面盘点，tasks 4.1）：四 key 原在 `settingsContext`（`appShellDomainContexts.ts`），四个消费集全选该域。真实消费点：`layoutNodes`（sidebar/topbar 节点构建）、`sections`（flows/searchRadar/quickSwitcher）、`render`（仅 Settings 的 workspace 数据管理读 `threadsByWorkspace/threadListLoadingByWorkspace`）、`layoutNodesChrome`（**零直接消费者**，仅因侧栏数据此前经 settingsContext 进 chromeBag）。

分两阶段落地（本 change 交付 4a）：

### 4a（已交付）：域迁移 + 冷域收窄 + 红线 gate

- 新增 `threadDataContext`（第 15 域），owner builder `buildThreadDataDomainContextSlice`（写权唯一 runtime thread host），hard budget 4 咬死；settingsContext 36 → 32。
- 消费集：`layoutNodes` / `layoutNodesCanvas`（侧栏节点数据随 canvas zone bag 供应）/ `sections` / `render` **显式**选择该域；**`layoutNodesChrome` 不选择** → 线程 dispatch 不再重建 chrome bag。
- 收益：① threads map 脱离 settingsContext——settings UI / terminal / radar UI 态的 bag 不再与线程态同域放大；② chrome zone 与线程 dispatch 解耦；③ 红线可执行化。
- 红线 gate（`threadDataSubscriptionRedLine.test.ts`）：四 key 归属断言 + chrome 排除断言 + sections/render 显式消费记录断言（防无差别回流）。

### 4b（后续批次，本 change 不交付）：逐点投影化收窄

- `render`：Settings 的 `workspaceThreadsById` 改由 settings surface 窄通道供给，移出 render 选择集；
- `sections`：flows/searchRadar/quickSwitcher 按消费点改布尔/计数投影或字段级选择；
- 每移出一个点更新红线 gate 的显式消费清单，最终目标是 sections/render 不再选择 `threadDataContext`。

## 测量与验收口径

- 每批次 TDD：先写红测试（断言新契约），实现后转绿；红测试必须先在现实现上跑出失败。
- Batch 4 后用设置页「最近卡顿（实时）」做真机对照：清空 → 快速连续切 5 个会话 → 对照本次基线（11:14 段：313/338ms、~70 updates）观察单 commit update 数与耗时；该复验记入 tasks 收口项（对应前 change 4.4 的复验方法）。
