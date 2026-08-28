# Delta: app-shell-domain-context-isolation

## ADDED Requirements

### Requirement: Thread Full Maps MUST NOT Be Indiscriminately Subscribed By Left/Right Consumer Sets

threads 全量 map（`threadsByWorkspace` / `threadStatusById` / `threadItemsByThread` / `threadListLoadingByWorkspace` 及同语义 history* 投影）MUST 归属独立 owner domain `threadDataContext`，MUST NOT 驻留在被 left/right 无差别消费集选择的热身 domain（`settingsContext`）中。`APP_SHELL_CONSUMER_DOMAIN_SELECTION` 的 `sections` / `render` / `layoutNodesChrome` 消费集 MUST NOT 选择 `threadDataContext`；确需读取线程态的消费点 MUST 走字段级窄选择或布尔/计数投影，并作为显式窄消费者记录。该红线 MUST 由可执行 gate 测试锁定，而非仅存在于文档。

#### Scenario: 线程 dispatch 不再失效 left/right bag

- **WHEN** 任一线程态 dispatch（如 `setActiveThreadId`、`threadStatusById` 更新）发生
- **THEN** `sections` / `render` / `layoutNodesChrome` 三个消费集的 bag 引用 MUST 保持稳定
- **AND** 仅选择 `threadDataContext` 的消费集（当前为 `layoutNodes`）与显式窄消费者重建

#### Scenario: 红线 gate 测试锁定消费集

- **WHEN** 红线 gate 测试扫描 `APP_SHELL_DOMAIN_CONTEXT_SELECTION` 与各消费集 bag 输出
- **THEN** `sections` / `render` / `layoutNodesChrome` 的选择集 MUST NOT 含 `"threadDataContext"`
- **AND** 三者 bag 构建结果 MUST NOT 含 `threadsByWorkspace` / `threadStatusById` / `threadItemsByThread` / `threadListLoadingByWorkspace` 任一 key

#### Scenario: owner map 完整性覆盖迁移后 key

- **WHEN** 四 key 迁入 `threadDataContext`
- **THEN** `APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS` MUST 同步新增该域 owner
- **AND** owner map 完整性 / 无重复 owner 测试 MUST 保持全绿
