# Delta: client-startup-orchestration

## ADDED Requirements

### Requirement: Full-catalog 自动重扫在连续超时后 SHALL 指数退避

同一 workspace 的 full-catalog 自动重扫（focus-refresh / 自动 ensure，非用户显式 force refresh）在连续因 timeout settle 时，客户端 SHALL 按连续超时次数指数拉长自动重试冷却：首次 timeout 冷却 ~60s，其后每次连续 timeout 冷却翻倍，封顶 ~15min。一次成功 settle 或用户显式 force refresh SHALL 重置该连续计数。非 timeout 原因的冷却与显式指定冷却时长的调用 MUST NOT 受退避影响。

#### Scenario: 连续 timeout 冷却翻倍并封顶

- **WHEN** 某 workspace 的 full-catalog 自动重扫连续多次以 timeout settle（无成功 settle、无 force refresh）
- **THEN** 自动重试冷却依次为 ~60s、~120s、~240s 递增
- **AND** 第 5 次连续 timeout 起冷却封顶 ~15min

#### Scenario: 成功 settle 重置退避

- **WHEN** 某 workspace 连续 timeout 之后出现一次成功的 full-catalog settle
- **THEN** 该 workspace 的连续超时计数 SHALL 清零
- **AND** 下一次 timeout 的冷却回到 ~60s

#### Scenario: 用户显式刷新重置退避

- **WHEN** 用户对某 workspace 触发 force refresh（`clearFullCatalogAutoRetryCooldown` 路径）
- **THEN** 冷却条目与连续超时计数 SHALL 一并清除，后续自动重扫按首次 timeout 处理

#### Scenario: 非 timeout 冷却不受退避影响

- **WHEN** 冷却由非 timeout 原因（如 degraded / force-enter）或显式 `cooldownMs` 触发
- **THEN** 冷却时长 MUST 与调用方指定值一致，不随 timeout streak 变化
