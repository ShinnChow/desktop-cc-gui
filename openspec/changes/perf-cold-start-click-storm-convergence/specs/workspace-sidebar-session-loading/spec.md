# Delta: workspace-sidebar-session-loading

## ADDED Requirements

### Requirement: Post-First-Paint Index Soft Re-Sync MUST Yield To Active Interaction

post-first-paint Session Index soft re-sync 的防饿死上限（defer 计数 / defer 窗口到期）SHALL 只改变「必须尽快找到执行时机」的优先级，MUST NOT 授权在用户仍处于活跃交互（quiet 检查不满足）时立即执行。defer 满上限后 SHALL 进入冷却并在下一个真实 quiet 窗口（≥ `POST_FIRST_PAINT_INDEX_SOFT_RESYNC_QUIET_MS`）执行；防饿死由「quiet 到达必跑」保证。新会话发现的兜底 SHALL 不依赖本条 resync（importer 轮询 + index 指纹 sync + 显式 reload `forceSessionIndexSync:true` 全量语义不变）。

#### Scenario: 点击风暴中 defer 满不触发强跑

- **WHEN** pointer soft-cancel 连续达到 `POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_DEFERS` 且 quiet 检查始终不满足
- **THEN** soft re-sync MUST NOT 执行 Session Index writer rescan
- **AND** 后续继续点击不得重新累积出「立即执行」许可

#### Scenario: 冷却后 quiet 窗口必跑（防饿死）

- **WHEN** 冷却期内出现 ≥ `POST_FIRST_PAINT_INDEX_SOFT_RESYNC_QUIET_MS` 的真实 quiet 窗口
- **THEN** soft re-sync SHALL 恰好执行一次
- **AND** 执行后计数与窗口按既有语义复位

### Requirement: First-Paint Warm Index Read MUST Carry Segmented Timing

first-paint 温索引读（`syncIfNeeded:false, forceSync:false`）SHALL 返回可选分段计时字段（`openMs` / `queryMs` / `totalMs`），前端 `thread/list session-index` 日志 MUST 透传落盘，用于冷启动温读延迟归因。温读路径 MUST NOT 因本条引入 writer rescan。预算数值（Win 冷启温读 <300ms）属真机验收口径，MUST NOT 写成时序断言单测。

#### Scenario: 温读计时落盘

- **WHEN** first-paint 温索引读完成
- **THEN** 返回体携带分段计时且日志 `thread/list session-index` 可见
- **AND** writer rescan 未被触发
