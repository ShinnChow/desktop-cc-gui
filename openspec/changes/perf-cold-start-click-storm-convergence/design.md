# Design: perf-cold-start-click-storm-convergence

## 证据 → 工作流映射

| 现场证据（2026-08-28 22:31） | 工作流 | 代码事实源 |
| --- | --- | --- |
| `session-index+sync syncMs=3111` 落在连续点击窗口（22:31:18） | F1 | `src/app-shell/sections/useWorkspaceThreadListHydration.ts` `POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_DEFERS=3` / `MAX_DEFER_WINDOW_MS=8000`，注释原文「force one run even while the user is still clicking」 |
| first-paint 温读 `syncMs=1082`（22:31:03） | F2 | `useThreadActions.ts` first-paint 分支 `syncIfNeeded:false`（温读路径）；Rust `session_index` 读侧无分段计时 |
| 14 次 `chat-stream/evict-thread`（cacheMax=12）、来回点重付 loadMs | F3 | `threadRuntimeOwnershipHelpers.ts:13` `THREAD_ITEM_CACHE_DEFAULT_MAX=12`；`useThreads.ts` 驱逐 effect 的 `evictableCandidates` 无 recency 维度 |
| dsh `host.describe` transport error ×2、`partial_history` 一串 | F4 | `src-tauri/src/engine/dsh/host.rs:14-15` `DESCRIBE_TIMEOUT=3s`/`RPC_TIMEOUT=30s`；无 connect_timeout、无熔断 |

## F1 soft re-sync 让路

**现状**：`runPostFirstPaintIndexSoftResync` 由 quiet-gated scheduler 驱动；pointer soft-cancel 计入 defer；`postFirstPaintIndexSoftResyncDeferCountRef` 满 `MAX_DEFERS(3)` 或首 defer 起 8s 窗口到期 → **无视交互立即跑**。设计意图是防「cancel→re-arm 死循环饿死」，代价是强跑正落在用户最忙的时刻（22:31:18 实测）。

**改法**：把「强跑」改成「冷却后必跑」：

1. defer 满上限 → 不再立即执行，进入 cooldown：重置 defer 计数，但下一次执行必须等到一个**真实 quiet 窗口**（≥ `POST_FIRST_PAINT_INDEX_SOFT_RESYNC_QUIET_MS` 无 pointer/keydown）。
2. cooldown 期间 pointer 仍只做 soft-cancel（既有语义），但 cancel 不再累积出新的「强跑许可」。
3. 收敛上限保留：cooldown 内若 `POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_WAIT_MS` 到期且期间至少出现过一次 quiet 窗口仍没跑成（理论不应发生），按原 max-wait 语义放行一次——上限只兜底收敛，不当「躲交互」的许可。
4. 饿死兜底说明（写进 spec scenario）：新会话发现不依赖这条 resync——importer 90s 轮询 + index 指纹 sync 仍在；显式 reload 的 `forceSessionIndexSync:true` 全量语义（`fix-sidebar-reload-force-index-sync`）不动。

**红线对齐**：不引入任何新的固定 `setTimeout` 当「修复」；quiet/max-wait 均沿用既有 gate 文档允许的「defer / convergence ceiling」语义（`windows-cold-start-click-freeze-pitfall.md` Required 1）。

**测试**：`useWorkspaceThreadListHydration.test.tsx` 已有 hydration/scheduler 测试群，新增红测：模拟连续 pointer defer ≥MAX_DEFERS 且 quiet 检查始终不满足 → 断言 `listThreadsForWorkspaceTracked`（soft resync 参数形态）**未被调用**；随后注入 quiet 窗口 → 断言恰好调用一次。防饿死对照红测：cooldown 后首个 quiet → 必跑。

## F2 first-paint 温读预算

**归因先行**：1082ms 目前只有一个总 `syncMs`，无法区分「SQLite 首开 / query / IPC 序列化 / importer 启动 rescan 锁等待」。改法分两步（严格测量先行，禁止直接拍修法）：

1. Rust 读侧返回分段计时（`openMs` / `queryMs` / `totalMs`），前端 `thread/list session-index` 日志透传落盘。字段为**可选新增**，旧后端兼容。
2. 依据真机归因再实施定向修（候选：importer 启动 rescan 对首读让路 / 连接预热点火提前到 setup / WAL checkpoint 时机），哪个证据成立修哪个，不预支。

**测试**：Rust 侧单测锁「温读路径（`syncIfNeeded:false, forceSync:false`）不触发 writer rescan」的既有语义 + 计时字段存在性；预算数值（<300ms）只进真机验收，**不写时序断言单测**（防 flaky）。

## F3 驱逐 recency 保护

**现状**：驱逐 effect 只看 activityTimestamp LRU + protected（active/pinned/in-flight）；「最近被切换过」不是保护维度。点击风暴里第 13 个会话一进来，最早活动的那批（可能正是 1 分钟前刚看过的）被整轮驱逐；回点即重付全额 loadMs。

**改法**：

1. 从纯函数切入（TDD 友好）：把 evictable 选择抽成 `selectEvictableThreadIds(input)` 放 `threadRuntimeOwnershipHelpers.ts`，输入含 `recentSwitchThreadIds: ReadonlySet<string>`（由 `useThreads` 切换路径维护，窗口 10 分钟，数量有界）。
2. 保护规则：recent set 内 threadId 不进 evictable；保护集整体受 `THREAD_ITEM_CACHE_RECENT_PROTECT_MAX = 8` 硬上限（超限时按 activityTimestamp LRU 在保护集内部再淘汰）——内存上界 ≈ cacheMax(12) + 8，不引入无界增长。
3. `computeThreadItemCacheMax(inFlightCount)` 既有公式不动（向后兼容既有测试）。
4. 驱逐的 ref 清理时序（`cleanupThreadScopedRefs` 先于 dispatch 等）原样走既有代码路径，本 change 不改协议，只改候选选择。

**测试**：新建 `threadRuntimeOwnershipHelpers` 驱逐选择测试：红1——20 会话 2 分钟内来回点，第 1 个会话（recent）不得被驱逐（现状实现会驱逐 → 红）；红2——recent 集合 >8 时保护集内部 LRU 淘汰仍生效；绿后接 `useThreads` 驱逐 effect 接线断言（传参 + recent 维护）。

## F4 dsh 宿主离线快速失败

**现状**：`dsh/host.rs` 的 reqwest client 只有总超时（describe 3s / RPC 30s）；daemon refused 时每次点击都重新发起注定失败的 `host.describe`，错误以字符串穿透到前端 loader（`thread/history loader error`），前端无「离线」结构化信号（只有设置页 doctor 的 `dshHostStatus`）。

**改法**：

1. client 增加 `.connect_timeout(Duration::from_millis(800))`——refused 场景本就快，慢网/防火墙 drop 场景从 3s 收到亚秒。
2. 模块级熔断器 `DshTransportBreaker`（`AtomicU32 consecutive_failures` + `AtomicI64 open_until_ms`）：连续 ≥2 次 transport error → open 60s；open 期内 `describe`/RPC 直接返回结构化 `Down { reason: "breaker-open" }`，不发 HTTP；冷却到期放行一次半开探测，成功即 close、失败重新 open。状态机纯逻辑独立成 `breaker.rs` 便于单测。
3. 前端：loader 识别结构化 Down → 不可重试、直接走 V0/本地快照可读回退（既有 `reopenOutcome:"recovered"` 链路），错误日志降级为单条状态事件；`dshHostStatus.ts` 增加 breaker-open → `kind:"down"` 映射（纯函数，已有测试文件扩展）。
4. 不碰 supervisor 拉起策略；不改 `session-switch-catalog-fetch-pitfall` 管辖的任何点击路径 catalog 语义。

**测试**：Rust `breaker` 状态机单测（close→open→half-open→close/open 全迁移 + 并发计数语义）；前端 `dshHostStatus.test.ts` 扩展映射用例 + loader Down 分支不重试断言。

## 批次与提交纪律

每批红→绿→重构独立提交（TDD），批内 `git diff --stat` 自查防格式化噪音；F1/F3 触碰 app-shell/threads 热区，提交过 `npm run check:app-shell:governance`；F4 触碰 `.rs` 过 `rustfmt --edition 2021 --check`。批次顺序：F4（独立、风险最低）→ F3 → F1 → F2（归因后再修）→ F5 验收回填。

## 风险

- F1 改动调度语义，最坏情况是 resync 比现在晚——由 importer 轮询 + 显式 reload 兜底，spec scenario 锁「quiet 到达必跑」防回归成永久饿死。
- F3 内存上界 = cacheMax + 8 个会话条目，较现状多驻留 ≤8 个会话的 items；如有需要由后续字节预算 change 收紧（本 change 不做字节计量，避免范围膨胀）。
- F4 熔断误开（daemon 实际恢复但 breaker 未半开探测成功）由 60s 冷却 + 半开探测自愈；设置页手动「重测」入口（若存在 doctor recheck）显式 reset breaker。
