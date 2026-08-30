# Delta: client-storage-performance

## MODIFIED Requirements

### Requirement: Error Diagnostics MUST Carry Structured Attribution Fields

崩溃与报错类持久化诊断（`react/error-boundary*`、`window/error`、`window/unhandledrejection`）SHALL 在不放松内容脱敏策略的前提下携带结构化取证字段：`errorName`（错误构造名）、`messageHash` / `messageLength`（错误文本指纹）、error-boundary 附加 `componentFrames`（componentStack 解析出的组件名数组，≤12 帧；**匿名组件帧（`at <anonymous>` 等）SHALL 记为 `"anonymous"` 而非丢弃**）与 `componentStackLineCount`（stack 行数计数，用于区分 stack 为空与格式不匹配）；`window/error` 与 worker 崩溃诊断 SHALL 附 `sourceModule`（`event.filename` basename，定位抛错模块）/ `sourceLine` / `sourceCol`。`message` / `error` / `componentStack` / `filename` 文本本体 MUST 保持脱敏；新增字段 MUST NOT 进入分享白名单。

#### Scenario: 匿名组件树崩溃可定位到「存在帧」

- **WHEN** 崩溃发生在无 displayName 的组件树（componentStack 全为 `at <anonymous>` 帧）
- **THEN** `componentFrames` MUST 为 `["anonymous", ...]` 而非空数组
- **AND** `componentStackLineCount` MUST 反映真实行数

#### Scenario: 抛错模块可从本地日志直读

- **WHEN** `window/error` 或 worker 崩溃诊断持久化
- **THEN** payload MUST 含 `sourceModule` / `sourceLine` / `sourceCol`
- **AND** `filename` 本体仍为脱敏值

### Requirement: Frame Drop Evidence MUST Survive Restart

掉帧证据 SHALL 维护持久化的会话级 worst-K（K=10）环：deltaMs 进入 top-10 的新样本 MUST 以 `perf.frame-drop-worst` 持久化（60s 节流），条目时间戳 MUST 为 epoch 毫秒（可直接换算钟点），条目携带的掉帧热点归因 MUST 以**扁平化字符串数组**形态落盘（第 3 层深度，sanitize 深度限制内存活），不得以嵌套对象形态被截断为 `[truncated]`。

#### Scenario: 归因在持久化后可读

- **WHEN** worst-K 条目落盘并经 sanitize
- **THEN** 每条 hotspot 为可读字符串（含 category 与耗时聚合），非 `[truncated]`

#### Scenario: 时间戳可对钟点

- **WHEN** 读取落盘的 worst-K 条目
- **THEN** `at` 为 epoch 毫秒，可直接换算为本地钟点时间
