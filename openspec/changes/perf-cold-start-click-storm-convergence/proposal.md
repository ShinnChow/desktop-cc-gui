# Change: perf-cold-start-click-storm-convergence

## Why

2026-08-28 22:31 生产构建（0.9.4 打包版，Windows WebView2）真机现场：用户冷启动后立即连续点击侧栏会话，两分钟内体感「卡顿 + 卡死」。`~/.ccgui/client/diagnostics.json` / `threadSessionLog` / `error-log` 证据链：

- **22:31:00** `cc-gui.exe` 启动；**22:31:03** first-paint 温 SQLite 读 `syncMs=1082`（应「ms 级」）。
- **22:31:05–22:31:18** 连续 10 次会话切换，`perf.thread-switch` durationMs **201~610ms**（loadMs 182~477，assembleMs 已被 tail-first 压到 2~37ms——组装段不是剩余瓶颈）。
- **22:31:09–22:31:29** 20 秒内 **60 个 longtask、累计 ~5.9s 主线程占用**，PerformanceObserver 回调被饿到 22:31:29 才一次性刷出——即「卡死」主体；**22:31:29** 页面整页导航（LCP navigate，epoch 22:31:29.025）。
- **22:31:18** post-first-paint soft re-sync 在点击风暴中强跑：`session-index+sync syncMs=3111`——现有 `POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_DEFERS=3` 设计为「防饿死：defer 满三次或 8s 窗口到期即**强行跑一次，哪怕用户仍在点击**」（`useWorkspaceThreadListHydration.ts`）。写者 rescan 与逐点击的历史 JSONL 读同盘竞争（Windows 上叠加 Defender 实时扫描放大），merge 上屏也正落点击流。
- **22:31:37–22:32:12** 继续切换仍 98~220ms/次；**14 次 `chat-stream/evict-thread`**（`THREAD_ITEM_CACHE_DEFAULT_MAX=12`）——来回点超过 12 个会话就驱逐→重进全额重付 loadMs。
- **22:31:40–22:32:12** dsh 宿主离线（`http://127.0.0.1:3080` refused）：shared 会话逐个走注定失败的 `host.describe`（`DESCRIBE_TIMEOUT=3s` 兜底）→ 2 条 `thread/history loader error` + 一串 `partial_history` 警告；无熔断、无 UI 离线信号。
- 汇总：两分钟 **37 次切换共 8.2s 切换耗时 + 117 个 longtask 共 11.1s 主线程占用**。

## 是不是 Windows 特有（用户问题，写进证据）

- **结构性成本跨平台**：切会话点击路径的 load/parse/commit 在 Mac 同样存在且已被实锤——`fix-session-load-bridge-freeze` 的 dev 真机数据（2140 条会话 8488ms、同刻 rAF 停摆 6683ms）与 client store 274KB→3338ms 先例都是 WKWebView 桥。Mac「好点」= 同构成本幅度更小。
- **「卡死感」Windows 特有**：WebView2 compositor 的 hit-test **必须等最新 layout**，主线程忙时任意点击表现为整窗假死；WKWebView 有时还能用 stale tree 响应（`dev-guidelines/guides/windows-cold-start-click-freeze-pitfall.md` 已证实模型）。同一点击 Windows 更像「死了」。
- **Windows 放大器**：文件系统 + Defender 实时扫描让 index writer rescan 与历史读的同盘竞争远重于 macOS；进程/daemon 冷启动更慢。
- **环境因素（平台无关）**：本次 dsh daemon 未启动是本机环境问题，但点击路径对「注定失败的传输」没有快速失败，属于产品韧性缺口。

## What Changes

- **F1 soft re-sync 让路重构（`useWorkspaceThreadListHydration.ts`）**：defer 满上限后**不再在点击风暴中强跑**；改为「进入冷却，在下一个真实 quiet 窗口（≥ `POST_FIRST_PAINT_INDEX_SOFT_RESYNC_QUIET_MS`）执行」。防饿死语义保留：quiet 到来必跑 + 既有 max-wait 仅作收敛上限（符合 win 冷启动 gate「timeout 只能当 convergence ceiling」）。
- **F2 first-paint 温读预算（`src-tauri/src/session_index/**`）**：温读 `list_session_index` 加分段计时（DB open / query / total），先归因 1082ms 再定向修（嫌疑：冷启首开与 importer 启动 rescan 锁竞争）；目标 Win 冷启温读 <300ms，证据回填。
- **F3 驱逐 recency 保护（`threadRuntimeOwnershipHelpers.ts` + `useThreads.ts` 驱逐 effect）**：`computeThreadItemCacheMax` 基础上叠加「近期切换保护集」——10 分钟内切换过的会话不进 evictable，保护集设硬上限防内存失控；来回点击场景不再「第 13 个会话触发整轮驱逐→重进重付」。
- **F4 dsh 宿主离线快速失败（`src-tauri/src/engine/dsh/host.rs` + 前端 loader）**：HTTP client 加 `connect_timeout`；传输层熔断器（连续 ≥2 次 transport error → 60s 冷却内直接返回结构化 Down，半开探测恢复）；前端把结构化 Down 视为不可重试，直接走 V0/本地回退 + 既有 `dshHostStatus` down 视图。
- **F5 Windows 真机验收**：对齐 win 冷启动 pitfall 验收矩阵第 5 条（侧栏会话）扩展「冷启 5 秒内连点 ≥12 会话 + dsh 离线」场景。

## Capabilities

### Modified Capabilities

- `workspace-sidebar-session-loading`：ADDED requirement——post-first-paint index soft re-sync MUST 让路活跃交互（defer 满不等于强跑许可）；ADDED requirement——first-paint 温索引读 MUST 带分段计时并受预算验收。
- `conversation-realtime-cpu-stability`：ADDED requirement——线程条目缓存驱逐 MUST 保护近期切换集（有界）。
- `dsh-session-history`：ADDED requirement——dsh 宿主不可达时打开路径 MUST 快速失败并降级可读（熔断 + 结构化 Down）。

## Non-Goals（与在途 change 的边界）

- **不碰 loadMs 固定成本与 IPC 载荷形态**：`resolve_session_file` 目录扫描嫌疑、`payload_json` 单字符串通道归 `fix-session-load-bridge-freeze` tasks 1.x/3.x/5.x（在途未完成项）。
- **不碰切会话渲染扇出 / client-store-write 热点**（`threads:turnFinalMeta`、`threads:sidebarSnapshot`）：归 `fix-session-switch-jank-red-lines` 4b.x（在途）。
- **不碰切会话 catalog 语义**：`session-switch-catalog-fetch-pitfall` 红线不变——点击路径零 `refreshEngineModels` / `get_engine_models` / `vendor_switch_*`。
- **不碰冷启动编排**（bootstrapApp / ReleaseNotes / ComposerGate）：`windows-cold-start-click-freeze-pitfall` 已收口范畴。
- **不碰 dsh supervisor 拉起策略**：只做客户端（打开路径）侧韧性；daemon 为何不在是独立问题。
- **不改驱逐的 ref 清理协议**（`cleanupThreadScopedRefs` 时序等既有 requirement 原样保留）。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Frontend | `useWorkspaceThreadListHydration.ts`（soft re-sync 调度）、`threadRuntimeOwnershipHelpers.ts` + `useThreads.ts`（驱逐策略）、dsh 历史loader错误映射 |
| Backend | `src-tauri/src/engine/dsh/host.rs`（connect_timeout + 熔断）、`src-tauri/src/session_index/**`（计时打点） |
| 热路径 | soft re-sync 从「风暴中强跑」变「quiet 窗口跑」；驱逐次数下降；dsh 离线打开延迟从最长 3s 降到 ms 级回退 |
| 兼容性 | 无 IPC schema 破坏性变更（新增可选计时字段 / 结构化 Down 枚举） |
| Gate | 改 `src/app-shell/sections/**` → 实施前重读 app-shell 两份 plan 文档，提交过 `npm run check:app-shell:governance` |

## Acceptance

1. Windows 打包版冷启动 5 秒内连点 ≥12 个会话：整窗保持可点（对齐 pitfall 验收矩阵），`threadSessionLog` 时间线中 `session-index+sync` 不落在连续点击窗口内。
2. 同场景 `perf.thread-switch` durationMs 分布对照本 proposal 基线（201~610ms）显著收敛；`chat-stream/evict-thread` 次数下降（来回点 20 个会话 2 分钟内 ≤3 次）。
3. dsh daemon 停止状态下点开 dsh/shared 会话：可读回退出现时间 <300ms（熔断生效后 <50ms），无 `thread/history loader error` 刷屏，设置侧 dsh 状态显示 down。
4. 温读分段计时落盘；Win 冷启 first-paint 温读 <300ms（证据回填 tasks）。
5. macOS 回归：未测须写明「未测」，禁止默认通过。
6. `openspec validate perf-cold-start-click-storm-convergence --strict` 通过。
