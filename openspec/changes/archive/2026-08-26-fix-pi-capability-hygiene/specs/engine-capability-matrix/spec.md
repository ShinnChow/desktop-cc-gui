## MODIFIED Requirements

### Requirement: PI MUST NOT claim live tool-output streaming

PI 工具卡片有 start/end，但 RPC 宿主不订阅 `tool_execution_update`。矩阵 MUST 把 `streaming.tool-output` 标为 `unsupported`；MUST NOT 标成 `supported` 来倒逼接高频流。本 requirement 的权威事实源是 fixture（`openspec/specs/engine-capability-matrix/fixtures/matrix.json` pi 行），spec 正文不逐引擎展开。

#### Scenario: Query PI live tool-output

- **WHEN** a caller asks the capability matrix for `pi` / `streaming.tool-output`
- **THEN** the state SHALL be `unsupported`
- **AND** `tool.use` SHALL remain `supported`（工具调用本身仍可用）
