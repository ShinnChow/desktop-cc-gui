# Delta: sidebar-list-timeout-fallback

## MODIFIED Requirements

### Requirement: full-catalog hydration 子源 timeout 保留 last-good

当 sidebar `listThreadsForWorkspace` 在 **full-catalog hydration** 中，任一被纳入主链路 mergedById 投递的引擎子源（当前为 Claude、OpenCode）在 `withTimeout` 窗口内返回 `null`，系统 MUST 保留上一轮 last-good 中该引擎的非 archived / 非 shared / 非 pending 条目，并通过统一的 engine-aware seed 路径将其投递回 mergedById，再继续与其他成功子源合并。

timeout 判定 MUST 仅适用于「实际发起了该子源请求且 `withTimeout` 竞出」的场景。对**按设计跳过子源请求**的路径（first-paint hydration 与 focus-refresh merge 中 `Promise.resolve(null)` 的占位结果），系统 MUST NOT 记录 timeout 语义：`rememberPartialSource("<engine>-session-timeout")` / `thread/list * timeout` 调试事件 / `partial-thread-list` degraded 标记均 MUST NOT 因占位 null 触发。last-good seed 兜底（`seedLastGoodEngineIntoMerged` 或行为等价路径）在跳过路径下 MUST 照常执行。

#### Scenario: claude subsource timeout preserves last-good claude entries

- **WHEN** full-catalog hydration 中 `claudeResult.status === "fulfilled"` 且 `claudeResult.value === null`（withTimeout 竞出）
- **THEN** 最终写入 store 的 thread 列表 MUST 包含上一轮 last-good 中所有 retainable 的 Claude 条目
- **AND** 系统 MUST 通过 `seedLastGoodEngineIntoMerged("claude", ...)` 或行为等价路径完成投递

#### Scenario: focus-refresh merge 跳过子源不产生假 timeout

- **WHEN** `recoverySource === "focus-refresh"` 且 `mergeExistingThreads === true` 的 merge 路径按设计跳过 claude 磁盘 list 与活动 catalog（占位 `null` 结果）
- **THEN** 系统 MUST NOT 投递 `thread/list claude timeout` / `thread/list codex catalog timeout` 调试事件
- **AND** 系统 MUST NOT 记录 `claude-session-timeout` / `codex-catalog-timeout` partialSource，可见列表 MUST NOT 被标记 `partial-thread-list` degraded
- **AND** last-good Claude 行 MUST 仍出现在最终列表

#### Scenario: full-catalog 真实 timeout 语义不变

- **WHEN** 非 focus-refresh 的 full-catalog 路径中 claude/codex 子源 `withTimeout` 真实竞出
- **THEN** 系统 MUST 按既有契约记录 partialSource、投递 timeout 调试事件并标记 degraded

#### Scenario: opencode subsource timeout preserves last-good opencode entries

- **WHEN** full-catalog hydration 中 `opencodeResult.status === "fulfilled"` 且 `opencodeResult.value === null`（withTimeout 竞出）
- **THEN** 最终写入 store 的 thread 列表 MUST 包含上一轮 last-good 中所有 retainable 的 OpenCode 条目

#### Scenario: codex catalog timeout does not pollute base entries

- **WHEN** codex catalog 子源在 full-catalog hydration 中 `withTimeout` 竞出
- **THEN** 系统 MUST 记录 `codex-catalog-timeout` partialSource 并投递 `thread/list codex catalog timeout` 调试事件
- **AND** 已合并的非 codex 基础条目 MUST NOT 被移除

#### Scenario: gemini async refresh timeout does not touch main merge pipeline

- **WHEN** Gemini 异步刷新任务 timeout
- **THEN** Gemini 任务 MUST 在 timeout 分支直接 `return`，不访问主链路 mergedById
- **AND** 系统 MUST NOT 因 Gemini timeout 而修改其他引擎在主合并管道中已生成的列表
