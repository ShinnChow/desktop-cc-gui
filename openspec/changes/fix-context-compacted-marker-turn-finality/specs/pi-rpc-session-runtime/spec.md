## ADDED Requirements

### Requirement: PI compaction 事件 MUST 映射 canonical thread/compaction 方法并携带元数据

PI RPC 的 `compaction_start` / `compaction_end` 事件 MUST 经 `EngineEvent::Raw` 映射为 canonical `thread/compacting` / `thread/compacted` / `thread/compactionFailed`（与 Claude 共用幕布渲染面）。`compaction_end` 成功映射的 params MUST 透传 pi 提供的元数据：`reason`（`threshold` / `overflow` / `manual`）、`tokensBefore`、`estimatedTokensAfter`、`firstKeptEntryId`；payload 缺失的字段 MUST 置 `null`，MUST NOT 伪造取值（`thread/compacting` 的 reason 缺省 `"manual"` 为既有契约，不受本条约束）。

#### Scenario: compaction_end 透传 reason 与 token 前后值

- **WHEN** pi 发出 `compaction_end`（`reason: "threshold"`、`tokensBefore: 236505`、`estimatedTokensAfter: 41200`）
- **THEN** 映射出的 `thread/compacted` params MUST 含 `reason: "threshold"`、`tokensBefore: 236505`、`estimatedTokensAfter: 41200`
- **AND** 前端留痕 MUST 能据此区分自动/手动压缩并展示 token 变化

#### Scenario: 缺失 reason 置 null 不伪造

- **WHEN** pi 发出的 `compaction_end` payload 不含 `reason`
- **THEN** 映射出的 `thread/compacted` params 的 `reason` MUST 为 `null`
- **AND** MUST NOT 缺省为 `"manual"`
