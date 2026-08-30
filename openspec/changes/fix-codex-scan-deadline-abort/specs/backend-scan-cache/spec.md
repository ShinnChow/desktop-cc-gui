# Delta: backend-scan-cache

## ADDED Requirements

### Requirement: Codex 会话列表扫描 SHALL 在内层 deadline 真正终止

`list_workspace_sessions`（preview catalog）背后的 codex 磁盘列表扫描（workspace list / global list 路径）SHALL 携带内层硬截止（~32s，对齐前端 catalog 30s 超时 + 2s 余量）：解析循环在截止到期时 SHALL 立即返回 Err 并停止读盘，禁止依赖外层 `timeout` 放弃 JoinHandle 后让扫描线程继续运行至自然结束。截止触发的 Err 与现有扫描 timeout 同语义（不落 fresh、不 commit partial）。session-index writer / Full 模式扫描 / day-dir backfill 等其余调用方 MUST NOT 因此改变行为（显式不携带截止）。

#### Scenario: 截止到期立即终止

- **WHEN** 列表扫描进入解析循环时截止已到期
- **THEN** 扫描 SHALL 不打开任何候选文件，返回含 deadline 语义的 Err

#### Scenario: 截止未到期行为不变

- **WHEN** 扫描携带远期截止（如 +60s）
- **THEN** 扫描结果与不携带截止的既有行为一致

#### Scenario: 其余调用方不受影响

- **WHEN** session-index writer 或 Full 模式扫描执行
- **THEN** 不携带截止，扫描行为与现状一致
