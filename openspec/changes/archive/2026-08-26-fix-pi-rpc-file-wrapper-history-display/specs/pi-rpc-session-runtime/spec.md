## ADDED Requirements

### Requirement: 历史回放 MUST 剥离两种时代的文件附件包装

系统 MUST 在 PI 历史回放（消息正文与侧栏标题）同时剥离 `<file name="...">`（print-json 时代 pi CLI 注入）与 `<file path="...">`（RPC 时代 mossx 注入）两种附件包装，禁止把包装标签或其内联正文当用户消息展示。

#### Scenario: RPC 时代 path= 包装正文剥离

- **WHEN** `load_pi_session` 读到 user text block 含 `<file path="/abs/CHANGELOG.md">正文</file>`
- **THEN** 可见正文 MUST NOT 包含 `<file` 标签或附件内联正文
- **AND** 非图片附件路径 MUST 以 `@/abs/CHANGELOG.md` 形式回到可见正文（保留附件引用）
- **AND** 该路径 MUST NOT 进入 `images`（前端无扩展名过滤，会渲染裂图 chip）

#### Scenario: 文本附件与图片 content block 混合消息

- **WHEN** 同一条 RPC user message 同时含 `<file path="...md">` 包装与 `{type:"image", data}` content block
- **THEN** 包装 MUST 被剥离且图片 block MUST 仍投影为可展示 `images`
- **AND** 非图片 wrapper 路径 MUST NOT 顶掉 content-block 图片投影

#### Scenario: 图片 wrapper 语义保持

- **WHEN** user text block 含图片路径的 `<file name="...png">` 包装（print-json 时代）
- **THEN** 图片路径 MUST 继续进入 `images`，且同条 message 的 content-block base64 MUST NOT 二次投影（既有语义不变）

#### Scenario: 侧栏标题剥离 path= 包装

- **WHEN** `read_session_summary` 提取的首条用户消息含 `<file path="...">` 包装
- **THEN** 标题 MUST 剥离包装只留用户文本
- **AND** 纯附件消息标题 MUST 回退 `[附件]` 标记
