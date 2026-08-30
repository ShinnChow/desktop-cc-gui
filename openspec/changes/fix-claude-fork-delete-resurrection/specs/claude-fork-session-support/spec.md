## ADDED Requirements

### Requirement: Synthetic Fork Bootstrap MUST NOT Persist Into Session Index

`claude-fork:<parentSessionId>:<bootstrap>` 形态的合成 fork bootstrap ID MUST NOT 产生任何 Session Index 行（包括经 bare-id 截断派生的 mangled 键）；其 runtime 内侧栏可见性 MUST 由 reducer 的 provisional thread preservation 保证，跨重启持久化 MUST 在 canonical child 身份（`claude:<childSessionId>`）建立后经 remap 链路写入真实键实现。

#### Scenario: bootstrap fork write does not touch session index

- **WHEN** 用户从 finalized parent 创建 Claude Fork 且尚未发送第一条消息
- **THEN** frontend 的 client-created index 写入链路 MUST NOT 为该 `claude-fork:*` 合成 ID upsert 任何行
- **AND** 该行在当前 runtime 内 MUST 保持可见

#### Scenario: first send migrates persistence to canonical key

- **WHEN** fork 首条发送成功且 identity 迁移为 `claude:<childSessionId>`
- **THEN** 系统 MUST 只以 canonical child session id 写入 Session Index
- **AND** 系统 MUST NOT 留下以合成 bootstrap payload 派生的持久行

### Requirement: Fork Deletion MUST Purge Companion Persistence Copies

删除 `claude-fork:*` 行的结算成功路径 MUST 同步清除两类伴生持久副本：① 以合成 ID payload 冒号后部分为键的既有 mangled Index 行（tombstone）；② 持久化 sidebar 快照中的该行。清除失败 MUST NOT 阻塞删除结算。

#### Scenario: deleting a synthetic fork row tombstones the mangled companion key

- **WHEN** 用户删除一个 ID 为 `claude-fork:<payload>` 的会话且删除结算为幂等成功码
- **THEN** 系统 MUST 以 `<payload>` 原样 tombstone 对应 mangled Index 行
- **AND** 该操作 MUST NOT 触碰其他 engine 或其他 session 的 Index 行

#### Scenario: deleted rows are purged from persisted sidebar snapshot

- **WHEN** 任一会话删除进入缓存清理收口（含批量）
- **THEN** 持久化 sidebar snapshot MUST 在合并后的单次读-改-写中移除这些行
- **AND** 未受影响的 workspace 与行 MUST 原样保留
- **AND** 排队的 id 不存在于快照时 MUST NOT 产生写放大
