# Delta: provider-model-catalog-refresh

## ADDED Requirements

### Requirement: Capability-Degraded PI Catalog MUST Self-Heal on Model Menu Open

Native/legacy composer 打开模型选择菜单时，若当前 PI 引擎组非空、非 fallback-only、且全部行 `provenance == "cli:pi-list-models"`（表格解析降级源，无法携带 `thinkingLevelMap`），系统 MUST 复用既有刷新链路触发一次 forceRefresh 全链重探。判定 MUST 与 fallback-only 自愈一致：每次打开最多一次，刷新进行中不重入，失败不循环重试（下次打开可再试）。探测成功（整组 provenance 变为 `cli:pi-available-models`）后判定 MUST 自动失效。本判定 MUST 仅作用于 PI；其他引擎与 Atomic 双栏路径的行为 MUST 零变化。composer 模型行 MUST 透传后端 `provenance` 字段以支撑该判定。

#### Scenario: degraded catalog triggers one refresh on menu open

- **WHEN** PI 整组模型行 `source = "detected"` 且 `provenance = "cli:pi-list-models"` 时用户打开模型菜单
- **THEN** 系统 MUST 触发一次配置刷新（forceRefresh 全链重探）
- **AND** 刷新进行中再次打开 MUST NOT 重复触发

#### Scenario: healthy projection is not re-probed

- **WHEN** PI 整组行 `provenance = "cli:pi-available-models"`（RPC 快照投影，含 models.json 无 map 的合法五档模型）
- **THEN** 打开菜单 MUST NOT 触发自动刷新

#### Scenario: mixed provenance does not trigger

- **WHEN** 组内 provenance 混合（含空值或非 list-models 来源）
- **THEN** 打开菜单 MUST NOT 触发自动刷新
