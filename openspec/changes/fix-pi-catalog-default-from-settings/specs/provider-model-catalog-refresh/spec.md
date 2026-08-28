## ADDED Requirements

### Requirement: PI Catalog Default Model MUST Resolve From PI Settings

PI catalog 的 default 标记 MUST 以 pi 自身配置（`<agent>/settings.json` 的 `defaultProvider` + `defaultModel`）为权威源：命中条目 MUST 标记 default 并置于 catalog 首位，其余条目 MUST 清除 default 标记。settings 不可用（文件缺失 / JSON 损坏 / 字段为空）或候选 id 未命中 catalog 时，MUST 维持既有兜底语义（枚举首条目为 default），MUST NOT 报错、MUST NOT 注入诊断噪音。候选 id MUST 依次尝试 `{defaultProvider}/{defaultModel}` 与裸 `{defaultModel}`（覆盖自定义 models.json 无 provider 前缀条目）。该解析 MUST 应用于 PI catalog 全部取数路径（RPC `get_available_models`、`--list-models` 回退链、generated fallback 汇合点）。

#### Scenario: settings default 命中 catalog

- **WHEN** `settings.json` 配置 `defaultProvider: "kimi-coding"`、`defaultModel: "k3"`，且 catalog 含 `kimi-coding/k3`
- **THEN** `kimi-coding/k3` MUST 携带 default 标记并位于 catalog 首位
- **AND** 原 first 条目（如 `anthropic/claude-fable-5`）MUST NOT 再携带 default 标记

#### Scenario: settings 不可用回退首条目

- **WHEN** `settings.json` 缺失或 JSON 损坏
- **THEN** catalog MUST 保持枚举首条目为 default（与既有行为一致）
- **AND** 探测结果 MUST NOT 因此产生错误诊断

#### Scenario: default 指向 catalog 外模型

- **WHEN** `defaultModel` 指向 catalog 不存在的条目（如 models.json 被删除后 settings 残留）
- **THEN** catalog MUST 保持枚举首条目为 default
- **AND** MUST NOT 合成新条目冒充 default

#### Scenario: 裸 defaultModel 命中自定义条目

- **WHEN** `settings.json` 仅含 `defaultModel`（无 `defaultProvider`）且 catalog 存在同名义条目
- **THEN** 该条目 MUST 按 default 解析
