# Change: fix-thread-list-timeout-backoff

## Why

用户实测报告（2026-08-27，Windows 生产 0.9.3，`diagnostics.json` 覆盖 08-22→08-27）：**切换会话卡顿，0.9.2 不卡**。数据钉死的放大回路：

- `thread/list claude timeout` / `thread/list codex catalog timeout`（各 30s）**129 次 / 49 分钟**，76% 成对同爆；4 个活跃 workspace 各 24-34 次，且逐小时升级（10 点档 45 → 11 点档 84）。该机上 claude/codex 列表扫描 **100% 打满 30s 超时**。
- 列表加载 233 次 / 53min ≈ 每 14s 一次。回路：`full-catalog` settle 为 timeout → `markFullCatalogAutoRetryCooldown(ws, "timeout")`（**固定 60s**）+ `clearFullCatalogFresh` → 冷却一过，下次 focus-refresh / 自动 ensure 又因非 fresh 全量扇出 → 再超时。**在「扫描永不成功」的机器上这是永不自愈的常驻后台风暴**：CPU/磁盘/IPC 持续被锤，每次 settle 的 `setThreads` merge 又在主线程制造周期性 jank，切会话（snapshot 重放 + timeline 渲染）的手感被持续拖慢。
- 排除项（同一数据源）：零 `perf.frame-drop` / 零 client-store-write hotspot（macOS WKWebView 桥冻结与该平台无关）；零 `fast-markdown-worker/failed`（生产 worker bundle 健康，崩溃循环是 dev-only）。

回归窗口说明：冷却 / freshness 脚手架 0.9.2 已有，但 0.9.3 的 staged loading 全程可见（573939e6）、focus-refresh 合并改动（dff066c7b）、强制 rescan（9b3beb964）、session-index 失效重扫（09acb2e1b）提高了加载与 settle 频次，让同样的「30s 永不成功扫描」在 0.9.3 变成用户可感知的常驻 churn。

## What Changes

- **连续超时的 workspace 自动重扫指数退避（核心止血）**：`fullCatalogAutoRetry` 新增 per-workspace timeout streak；`timeout` 原因的自动冷却从固定 60s 改为 `60s × 2^(streak-1)`，**封顶 15min**。用户显式 force refresh（`clearFullCatalogAutoRetryCooldown`）或一次成功 settle（新增 `noteFullCatalogAutoRetrySuccess`，接在 `markFullCatalogFresh` 旁）重置 streak。非 timeout 原因与显式 `cooldownMs` 传参行为不变。
  - 效果（按用户现场推算）：单 workspace 扇出频率从 ~1 次/分钟 降到 第 5 次起 1 次/15 分钟；4 个活跃 workspace 的全局 churn 从 ~50 次/小时 降到 ~16 次/小时后趋于 ~4 次/小时。
- **可观测性**：`getFullCatalogAutoRetryBlockedSnapshot` 行附 `streak=N`，StartupGateOverlay 诊断 dump 可直接看到退避层级。

## Capabilities

### Modified Capabilities

- `client-startup-orchestration`：ADDED requirement「Full-catalog 自动重扫在连续超时后 SHALL 指数退避」——timeout streak 驱动冷却时长，success / force refresh 重置。

### Non-Goals

- 不修 Windows 上 claude/codex 扫描 100% 30s 超时的根因（Defender / CLI spawn / 目录规模待 Windows 环境另案核查；本 change 只消除其前端放大效应）。
- 不动内层 per-engine `SIDEBAR_THREAD_LIST_TIMEOUT_MS`（30s）与外层任务预算（8/12/20s）的对齐问题（zombie 扫描浪费是次级问题，另案）。
- 不改 `thread/list session-index` first-paint 路径（实测 syncMs 18-27ms，健康）。
- 不动 focus-refresh 的 freshness TTL（60s）语义本身。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Frontend | `src/features/startup-orchestration/utils/fullCatalogAutoRetry.ts`（streak + backoff + success reset）；`src/app-shell/sections/useWorkspaceThreadListHydration.ts`（settle 两处接线：timeout 走 streak 退避、success 重置 streak） |
| Backend | 无 |
| 热路径 | 仅 full-catalog settle 分支（低频事件）；切会话点击路径零改动 |
| 兼容性 | 纯内存状态，无持久化、无协议变更；既有「冷却窗内阻止自动重扫 / force 清除」语义不变 |
| 验证方式 | TDD 先红后绿：`fullCatalogAutoRetry.test.ts` 扩 streak/封顶/重置用例；`useWorkspaceThreadListHydration` 相关测试回归；typecheck + prettier（仅本 change 文件） |

## Acceptance

- **A1（退避递增）**：同一 workspace 连续 timeout settle，自动重扫冷却依次为 ~60s、~120s、~240s（`2^streak` 递增），第 5 次起封顶 ~15min。
- **A2（成功重置）**：连续 timeout 后一次成功 settle（`markFullCatalogFresh` 路径）重置 streak，下一次 timeout 冷却回到 ~60s。
- **A3（force 重置）**：`clearFullCatalogAutoRetryCooldown`（用户显式刷新路径）同时重置 streak。
- **A4（行为兼容）**：非 timeout 原因（degraded / force-enter）与显式 `cooldownMs` 传参的冷却时长语义与现状一致；`isFullCatalogAutoRetryBlocked` / 冷却过期自动清除语义不变。
- **A5（回归）**：`fullCatalogAutoRetry.test.ts` 全绿；`useWorkspaceThreadListHydration` 相关测试无新增失败；`npm run typecheck` 0 error；改动文件 prettier clean（仅本 change hunk）。
