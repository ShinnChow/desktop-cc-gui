# Delta: client-storage-performance

## ADDED Requirements

### Requirement: Error Diagnostics MUST Carry Structured Attribution Fields

崩溃与报错类持久化诊断（`react/error-boundary*`、`window/error`、`window/unhandledrejection`）SHALL 在不放松内容脱敏策略的前提下增补结构化取证字段：`errorName`（错误构造名）、`messageHash` / `messageLength`（错误文本指纹，跨会话比对）、error-boundary 附加 `componentFrames`（componentStack 解析出的组件名数组，≤12 帧）。`message` / `error` / `componentStack` 文本本体 MUST 保持脱敏；完整错误文本 SHALL 仅进 console。新增字段 MUST NOT 进入 `buildDiagnosticsReportText` 的分享白名单。

#### Scenario: error-boundary 落盘可定位崩溃组件

- **WHEN** React error boundary 捕获渲染异常并上报
- **THEN** 持久化 payload MUST 包含 `errorName` / `messageHash` / `messageLength` / `componentFrames`
- **AND** `error` 与 `componentStack` 字段本体仍为脱敏值

#### Scenario: window 级错误可跨会话比对

- **WHEN** `window/error` 或 `window/unhandledrejection` 发生并持久化
- **THEN** payload MUST 包含错误/原因的构造名与文本指纹（hash + length）
- **AND** message/reason 文本本体仍为脱敏值

### Requirement: Frame Drop Evidence MUST Survive Restart

掉帧证据 SHALL 维护持久化的会话级 worst-K（K=10）环：deltaMs 进入 top-10 的新样本 MUST 以 `perf.frame-drop-worst` 持久化（60s 节流），entries 按 deltaMs 降序并携带掉帧现场 payload（hotspots 等），使最重卡顿证据在应用重启后仍可读。

#### Scenario: 最重现场重启后仍可读

- **WHEN** 会话内发生多轮掉帧且部分仅进 volatile 环后应用重启
- **THEN** 磁盘 `perf.frame-drop-worst` 条目 MUST 覆盖会话内最重的掉帧样本

#### Scenario: worst-K 环节流

- **WHEN** top-10 未变化或距上次持久化不足 60s
- **THEN** MUST NOT 重复持久化

### Requirement: Hotspot Aggregates MUST Be Periodically Persisted

主线程 hotspot 聚合 SHALL 按固定周期（60s）持久化为 `perf.hotspot-summary`：读取近 60s 窗口的 top 类别（totalMs / maxMs / maxDetail / count）并附带 isStreaming / visibilityState 上下文；窗口内无样本时 MUST NOT 写入。背景周期性主线程占用（如定时轮询引发的 commit）由此获得独立时间序列证据，不再依赖「恰好掉帧 ≥100ms」才被记录。

#### Scenario: 背景税有独立证据

- **WHEN** 应用空闲但存在 1ms 级以上的周期性主线程占用（如 60s 轮询引发的 react-commit）
- **THEN** 对应时间窗 MUST 出现 `perf.hotspot-summary` 条目且含该类别聚合

#### Scenario: 空窗口不写

- **WHEN** 60s 窗口内无任何 ≥1ms 样本
- **THEN** MUST NOT 追加 hotspot-summary 条目

### Requirement: Thread Switch Hydration MUST Leave Timing Evidence

会话切入的 hydrate 链 SHALL 每次落一条 `perf.thread-switch` 证据：`durationMs`（历史加载发起 → items 落库完成）、`itemCount`、`displayedCount`、`mode`（tail-first/atomic）、`engineSource`、`threadIdHash`、`fallbackWarningCount`。该证据使「切会话慢在加载还是渲染」可直接归因，并作为渲染优化的真机对照基线。隐私口径：threadId MUST 以短哈希落盘。

#### Scenario: 一次切入一条证据

- **WHEN** 任一会话 resume 的 hydrate 完成
- **THEN** MUST 存在一条含 durationMs / itemCount / displayedCount / mode / engineSource / threadIdHash 的 `perf.thread-switch` 条目
