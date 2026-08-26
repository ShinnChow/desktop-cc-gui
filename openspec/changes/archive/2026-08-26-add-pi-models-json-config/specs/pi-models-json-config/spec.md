## ADDED Requirements

### Requirement: 自定义供应商组 MUST 展示 models.json 摘要

「供应商认证」区块 MUST 包含第三组「自定义供应商」，读取 `~/.pi/agent/models.json` 并以只读列表展示每个 provider 的 `id` / `name` / `baseUrl` / `api` / 模型数。

- 文件路径解析 MUST 遵循：engine-config home override → `PI_CODING_AGENT_DIR` → `~/.pi/agent`。
- 文件不存在时 MUST 显示空态与引导文案，MUST NOT 报错。
- 文件 JSON 损坏时 MUST 显示可读错误横幅并仍展示原文供修复，MUST NOT 使整个区块不可用。
- 刷新 MUST 为事件驱动（挂载 / 保存成功 / 窗口 focus），MUST NOT 轮询。

#### Scenario: 正常展示

- **WHEN** `models.json` 定义了 `my-relay`（baseUrl、api、2 个模型）
- **THEN** 列表 MUST 显示一行：`my-relay`、其 baseUrl、api 类型、模型数 2

#### Scenario: 文件不存在

- **WHEN** `models.json` 不存在
- **THEN** 区块 MUST 显示空态文案
- **AND** MUST 提供「编辑配置」入口

#### Scenario: JSON 损坏

- **WHEN** `models.json` 含非法 JSON
- **THEN** 区块 MUST 显示错误横幅
- **AND** 编辑器 MUST 仍能打开原文供就地修复

### Requirement: 编辑配置 MUST 为整段文本编辑并预填默认示例

「编辑配置」MUST 展开多行等宽文本编辑器，内容为整个 `models.json` 原文（含注释）。

- 文件不存在或内容为空时，编辑器 MUST 预填默认示例模板（中转站 + Grok + `openai-responses` 形态）。
- 预填模板 MUST NOT 自动落盘；仅在用户显式保存时写入。
- 编辑器 MUST 支持保存 / 取消，保存中 MUST 防重复提交。

#### Scenario: 空文件预填模板

- **WHEN** `models.json` 不存在
- **AND** 用户点击「编辑配置」
- **THEN** 编辑器 MUST 显示含 `my-relay` + `grok-4.6` 的 JSONC 示例
- **AND** 磁盘上 MUST 仍无 `models.json`，直到用户保存

### Requirement: 保存 MUST 宽松校验并原子写入

`pi_models_config_write` MUST 仅在以下全部通过时写入：文本 strip 注释后可解析为 JSON；`providers` 存在时为对象；每个 provider 的 `models` 存在时为数组且每项含字符串 `id`。

- 校验 MUST 为宽松模式：未知字段 MUST NOT 导致拒绝。
- 写入 MUST 使用同目录临时文件 + rename 原子替换，Unix 权限 MUST 为 0600。
- 写入内容 MUST 为用户提交的原始文本，MUST NOT 做 parse→serialize 往返（注释、字段顺序、未知字段保留）。
- 任何校验或 IO 失败 MUST 返回可读错误，且原文件字节 MUST 保持不变。

#### Scenario: 未知字段保留

- **WHEN** 用户保存的 provider 含 pi 当前版本未定义的字段
- **THEN** 保存 MUST 成功
- **AND** 该字段 MUST 原样出现在写回的文件中

#### Scenario: 非法 JSON 拒绝写入

- **WHEN** 用户提交的文本无法解析为 JSON
- **THEN** 保存 MUST 失败并返回可读错误
- **AND** 原 `models.json` 内容 MUST 不变

#### Scenario: 结构非法拒绝写入

- **WHEN** `providers` 为数组而非对象
- **THEN** 保存 MUST 失败
- **AND** 原文件 MUST 不变

### Requirement: models.json 模块 MUST NOT 复用 auth.json 的凭证 mask 边界

`models.json` 的 `apiKey` 属用户自有配置（明文 / `$ENV` / `!command`），读取时 MUST 原文回显。模块头注释 MUST 声明该边界与 `pi_auth.rs`（key 永不回传前端）的差异，避免后续维护误合并两条安全策略。

#### Scenario: apiKey 原文回显

- **WHEN** `models.json` 中 provider 配置了明文 `apiKey`（或 `$ENV` / `!command` 引用）
- **THEN** read 返回的 `text` MUST 包含该字段原文
- **AND** 摘要列表 MUST 仅携带 `hasApiKey` 布尔，MUST NOT 单独回传 key 值
