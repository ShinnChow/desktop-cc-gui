## ADDED Requirements

### Requirement: Resident MUST 支持 engine-neutral 预热

后端 MUST 提供 `engine_prewarm(thread_id)` 通用 command，按 engine 分发：具备 resident 模型的引擎（pi）执行真实预热，其余引擎 MUST 返回 no-op。预热 MUST 幂等、与 `rpc_disabled` 闩同源 gate，且 MUST NOT 改变首次发送的 `ensure_resident` 主路径语义。

#### Scenario: pi 会话激活触发预热

- **WHEN** 前端激活 engine 为 pi 的会话（延迟 fire-and-forget，per-thread 去重）
- **AND** 调用 `engine_prewarm(thread_id)`
- **THEN** 后端 MUST 以与 send 路径同源的 session_id 推导定位 resident key
- **AND** 同步等待 spawn + handshake 完成（或发现 resident 已存活而早退）
- **AND** 预热结果不影响任何 turn 状态

#### Scenario: 预热幂等

- **WHEN** 同一 `(session_id, scratch)` 在 resident 已存活时被连续多次调用 `engine_prewarm`
- **THEN** MUST NOT 产生第二个 pi 进程（复用 `ensure_resident` 早退与 `pi_resident_map_key` 语义）

#### Scenario: rpc_disabled 闩冷却期内拒绝预热

- **GIVEN** `rpc_disabled_blocks_spawn` 闩处于冷却期
- **WHEN** 调用 `engine_prewarm`
- **THEN** MUST 与 `ensure_resident` 同源拒绝，不触发 spawn
- **AND** 闩自愈逻辑 MUST NOT 被预热调用搅动

#### Scenario: 预热失败不新增失败路径

- **GIVEN** 预热因任意原因失败（spawn 失败 / 闩拒绝 / 引擎不可用）
- **WHEN** 用户随后发送首条消息
- **THEN** 发送 MUST 仍走既有 `ensure_resident` 全路径并正常工作
- **AND** 前端 MUST 对预热失败静默（debug 遥测即可），不弹错、不改 UI 状态

#### Scenario: 非 resident 引擎 no-op

- **WHEN** 对无 resident 模型的引擎（如 claude per-turn spawn）调用 `engine_prewarm`
- **THEN** MUST 返回 no-op 成功（未预热），不 spawn 任何进程、不报错
