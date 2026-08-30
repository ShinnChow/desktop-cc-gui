# Delta: native-turn-badge

## ADDED Requirements

### Requirement: Native Send Boundary MUST Freeze Turn Execution Snapshot

Every native CLI send（composer 直发、queue drain、recovery resend）MUST record an
immutable `TurnExecutionSnapshot` keyed by workspace + native thread before the
turn request leaves the frontend. Composer-provided targets MUST be frozen at the
send boundary; messaging-layer fallbacks MAY synthesize from resolved
engine/provider/model/effort when options carry no frozen target. Shared session、
agent-canvas、`-pending-shared-` 路由 MUST NOT 写入该账本。

#### Scenario: composer send freezes the visible target

- **WHEN** 用户在 native 会话用 Atomic picker 选择了 PI CLI / 本地配置 / k3 / low 后发送
- **THEN** 发送前账本记录的 snapshot 与 picker 当前 `nativeSessionTarget` 一致

#### Scenario: pending alias 记账落在正式 thread id 上

- **WHEN** 首条消息经 `claude-pending-*` / `codex-pending-*` 递归重入后发出
- **THEN** 账本键为 reconcile/finalize 后的正式 thread id

### Requirement: Native Realtime Assistant Items MUST Carry The Recorded Snapshot

The first reducer bucket that creates or last merges a native assistant message
item during a recorded turn（首 delta 建壳、agentMessage snapshot/tail upsert、
converted message upsert、normalized 直达路由）MUST attach the ledger snapshot,
且 MUST NOT 覆盖 item 已携带的既有 snapshot（含 shared canonical 注入值）。

#### Scenario: 流式首 delta 建 shell 即带 badge 数据

- **WHEN** claude native 首个 agentDelta 到达并创建 assistant shell
- **THEN** 该 item 携带本轮账本快照，幕布渲染 turn-target 显示条

#### Scenario: mid-turn 目标变化不改写进行中 bubble

- **WHEN** 同一 assistant bubble 的后续 delta/snapshot 到达
- **THEN** 已有 snapshot 保持不变（existing-first）

### Requirement: Native Runtime Receipt Parity

Runtime model receipt capture MUST accept native thread ids using the same
source-rank merge（send.request → turn.completed → system.init.model →
assistant.message.model）。`patchAssistantRuntimeReceipt` 既有 anti-mislabel 守卫
（仅 patch 已带 snapshot/receipt 的 item）MUST keep unchanged。

#### Scenario: native 回复出现回执尾巴

- **WHEN** native turn 完成事件回写真实 model id
- **THEN** 本轮助手消息的显示条按 rank 合并出 `→ Ⓡ <model>` 尾巴与可展开面板

### Requirement: Native Turn Targets MUST Persist Across History Reload

每轮 native 发送 MUST 把冻结快照追加进 per-thread 历史侧车（threads client
store，有界 ring）；历史冷加载 MUST 按 user 轮次从尾部对齐补挂到缺失
`executionTargetSnapshot` 的助手消息上，且绝不覆盖既有值。对齐只保证最近
K 轮；更老轮次允许无 badge（不伪造 provenance）。

#### Scenario: 重开会话历史仍显示 badge

- **WHEN** native 会话发过若干轮后关闭再重开，历史经 setThreadItems 装载
- **THEN** 最近轮次的助手消息重新带上线程侧车中的快照并渲染显示条

#### Scenario: pi 等无回执事件的引擎也有可展开面板

- **WHEN** 发送时 send.request 记账存在而事件流从未回写真实 model
- **THEN** 助手消息携带 runtimeReceipt=send.request 记账，显示条出现 Ⓡ 尾巴，
  点击展开面板且「回执来源」如实标注请求名语义

### Requirement: Alias Rename MUST Migrate Ledger And Receipt Consistently

Pending → 正式 thread id rename 时，turn-target 账本迁移行为 MUST 与
`renameRuntimeReceipt` 现行语义一致（move-if-absent，不覆盖目标已有值）。
