# Delta: app-shell-domain-context-isolation

## ADDED Requirements

### Requirement: Thread Full Maps MUST NOT Be Indiscriminately Subscribed By Left/Right Consumer Sets

threads 全量 map（`threadsByWorkspace` / `threadStatusById` / `threadItemsByThread` / `threadListLoadingByWorkspace` 及同语义 history* 投影）MUST 归属独立 owner domain `threadDataContext`，MUST NOT 驻留在被 left/right 无差别消费集选择的热身 domain（`settingsContext`）中。`layoutNodesChrome` 消费集 MUST NOT 选择 `threadDataContext`（chrome zone 无线程 map 消费者）；`sections` / `render` 的消费 MUST 是显式且记录在案（红线 gate 测试断言其选择集成员），后续按消费点逐一投影化收窄。该红线 MUST 由可执行 gate 测试锁定，而非仅存在于文档。

#### Scenario: 线程 dispatch 不再扩散进冷域 bag

- **WHEN** 任一线程态 dispatch（如 `setActiveThreadId`、`threadStatusById` 更新）发生
- **THEN** `layoutNodesChrome` 消费集的 bag 引用 MUST 保持稳定
- **AND** `settingsContext` 的任何非线程 key 变化（settings UI / terminal / radar UI 态）MUST NOT 因 thread map 同域而放大失效面

#### Scenario: 红线 gate 测试锁定域归属与消费集

- **WHEN** 红线 gate 测试扫描 `APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS` 与 `APP_SHELL_CONSUMER_DOMAIN_SELECTION`
- **THEN** 四 key MUST 全部归属 `threadDataContext` 且不在 `settingsContext`
- **AND** `layoutNodesChrome` 选择集 MUST NOT 含 `"threadDataContext"`
- **AND** `sections` / `render` 若选择 `threadDataContext` MUST 被红线测试显式断言（记录在案，防止无差别回流）

#### Scenario: owner map 完整性覆盖迁移后 key

- **WHEN** 四 key 迁入 `threadDataContext`
- **THEN** `APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS` MUST 同步新增该域 owner
- **AND** owner map 完整性 / 无重复 owner 测试 MUST 保持全绿
