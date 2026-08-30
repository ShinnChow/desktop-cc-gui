# Change: enhance-perf-diagnostics-evidence

## Why

2026-08-28 性能排查实测暴露「本地诊断够多但关键取证缺失」，导致当次调优多处只能靠猜：

1. **崩溃/报错类诊断只剩骨架**：`window/error` 的 `message/filename/href` 全部 `[redacted]`（仅 lineno/colno）；`react/error-boundary` 的 `error/componentStack` 全部 `[redacted]`（仅 errorClass）。当天 3 次 `react/error-boundary` TypeError（其中 2 次恰在切会话最重卡顿时刻）无法定位崩溃组件，只能立案猜。
   - 根因：`isSensitiveDiagnosticField` 对含 `message/error/stack/reason` 等内容 token 的字段一律脱敏（防用户内容外泄，策略本身正确）。但**安全命名的结构化字段可以存活**（`errorClass`、`messageHash` 即证明）——缺的是调用点把可安全暴露的取证信息预整理成安全形状。
2. **掉帧证据重启即失**：`perf.frame-drop` 只有 severe（≥100ms）且 1/min 节流、命中 diagnostics 自身热点时还降级 volatile；volatile 环（200 条）纯内存，重启清零。当天面板最重的 338/313ms 两条在磁盘上搜不到。
3. **背景税无独立证据**：hotspot 聚合只在掉帧瞬间附着到 frame-drop payload；60s 级 idle 卡顿若某拍 <100ms 或被节流，对应的 hotspot 证据（谁在周期性打 commit）就永久丢失。当天 11:02–11:46 的 ~60s 周期卡顿源只能靠时间轴相关性和 git 轮询代码推断，无直接记录。
4. **切会话无计时证据**：resume 链（IPC load → parse → items 落库）各段耗时无任何落盘记录，4.5 真机对照复验只能靠「最近卡顿」面板的间接归因，无法回答「慢在加载还是渲染」。

约束：`buildDiagnosticsReportText`（复制卡顿现场的分享路径）按 REPORT_LABELS 白名单过滤，本 change 全部新增字段/label 均不进该白名单——增强只落在**本地 diagnostics.json**，不改变分享面的隐私边界；`message`/`stack` 本体保持脱敏（错误文本可能内嵌用户内容，完整文本仍只进 console）。

## What Changes

- **F1 error-boundary 结构化取证**（`ErrorBoundary.tsx`）：payload 增补 `errorName`、`messageHash`、`messageLength`、`componentFrames`（componentStack 解析出的组件名数组，≤12 帧、每帧 clip；字段名避开内容 token，策略内合法存活）。react-scan recovery 两条路径同步增补。
- **F2 window/error + unhandledrejection 结构化取证**（`rendererDiagnostics.ts` 安装段）：增补 `errorName`（`event.error?.name`）、`messageHash`、`messageLength`；unhandledrejection 增补 `reasonName`/`reasonHash`/`reasonLength`。message/reason 文本本体保持脱敏。
- **F3 掉帧 worst-K 持久环**（`frameDropMonitor.ts`）：内存维护 deltaMs top-10 全 payload；新样本进入 top-10 且距上次持久化 ≥60s 时以 `perf.frame-drop-worst` 落盘（durable），重启不丢最重现场。
- **F4 切会话计时证据** `perf.thread-switch`（`useThreadActionsResumeThread.ts` hydrate 段）：每次 resume 落一条 `durationMs`（loader 发起→items 落库）、`itemCount`、`displayedCount`、`mode`、`engineSource`、`threadIdHash`、`fallbackWarningCount`；直接服务 4.5 真机对照与下次「慢在加载还是渲染」归因。
- **F5 hotspot 周期汇总** `perf.hotspot-summary`（perfBaseline 新模块）：60s 定时读 `getRecentHotspotSummary(60_000)`，非空才落 durable（top 类别 totalMs/maxMs/maxDetail/count + isStreaming/visibilityState）。背景税（如 ~60s 周期源）从此有独立时间序列证据，不再依赖「恰好掉帧 ≥100ms 才有归因」。

## Capabilities

### Modified Capabilities

- `client-storage-performance`（Diagnostics Retention 域）：
  - ADDED requirement「Error Diagnostics MUST Carry Structured Attribution Fields」；
  - ADDED requirement「Frame Drop Evidence MUST Survive Restart」；
  - ADDED requirement「Hotspot Aggregates MUST Be Periodically Persisted」；
  - ADDED requirement「Thread Switch Hydration MUST Leave Timing Evidence」。

## Non-Goals

- **不放松 `isSensitiveDiagnosticField` 策略本体**：message/reason/stack 文本仍脱敏，完整错误文本仍只进 console（错误文本可能内嵌用户内容）。
- **不改分享路径隐私边界**：新字段/新 label 不进 `buildDiagnosticsReportText` 的 REPORT_LABELS 白名单，导出报告内容不变。
- **不新增远端上报**：全部仍落本地 `diagnostics.json`（受既有 256KB byte budget 与 MAX_PERF_ENTRIES=1000 上限约束）。
- **不动 react-scan topRenders 链路**（需 overlay 开启，属工具开关问题）。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Frontend | `components/ErrorBoundary.tsx`、`services/rendererDiagnostics.ts`、`services/perfBaseline/frameDropMonitor.ts`、`services/perfBaseline/hotspotSummaryRecorder.ts`（新）、`features/threads/hooks/useThreadActionsResumeThread.ts` |
| 隐私 | 新增字段全部为安全命名结构化信息（名称/哈希/计数/组件名）；组件名与错误名是代码标识符，不含用户内容；本地落盘，分享面不变 |
| 体积 | frame-drop-worst ≤10 条/次、60s 节流；hotspot-summary 60s 一条且非空才写；thread-switch 每次切换一条——三者均受 MAX_PERF_ENTRIES=1000 与 256KB budget 约束 |
| 验证方式 | TDD 先红后绿；`rendererDiagnostics.test.ts` / perfBaseline 测试 / `useThreadActions.test.tsx`；typecheck 0 |

## Acceptance

- **A1（F1）**：`react/error-boundary` 落盘 payload 含 `errorName`/`messageHash`/`messageLength`/`componentFrames`（组件名数组），且 `error`/`componentStack` 本体仍为 `[redacted]`。
- **A2（F2）**：`window/error` payload 含 `errorName`/`messageHash`/`messageLength` 且 `message` 本体仍 `[redacted]`；`unhandledrejection` 含 `reasonName`/`reasonHash`/`reasonLength`。
- **A3（F3）**：top-10 内的新掉帧触发 `perf.frame-drop-worst` 持久（60s 节流），entries 按 deltaMs 降序且含 deltaMs/hotspots；重启后磁盘可读。
- **A4（F4）**：一次 resume 完成后存在 `perf.thread-switch` 条目，含 durationMs/itemCount/displayedCount/mode/engineSource/threadIdHash。
- **A5（F5）**：有 hotspot 样本时 60s 内出现 `perf.hotspot-summary` 条目（top 类别齐全）；无样本不写。
- **A6（回归）**：`rendererDiagnostics.test.ts`（含既有 redact 断言）+ perfBaseline + threads 相关面全绿；typecheck 0；分享报告文本不包含新 label。
