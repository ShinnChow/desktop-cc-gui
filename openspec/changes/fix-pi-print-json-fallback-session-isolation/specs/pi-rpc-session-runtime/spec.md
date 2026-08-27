## MODIFIED Requirements

### Requirement: Resident MUST 按会话隔离（真并行）

系统 MUST 为每个 native PI session 维护独立的 `pi --mode rpc` resident process（map key = 有效 session id；无 id 的新发送用 scratch/turn 独占进程）。同一 workspace 的多条 PI 会话 MUST 能同时 streaming。禁止用一只进程靠 `switch_session` 串行所有标签。

workspace 级 `rpc_disabled` 闩（spawn/handshake 失败置位）MUST 只拦截新 spawn；已存活的 resident MUST 继续复用，不得因其它会话的一次 spawn 失败被降级。

#### Scenario: 两条 PI 会话同时发送

- **WHEN** 同一 workspace 中会话 A 正在 streaming，用户向会话 B（或新会话）发送
- **THEN** 系统 MUST 为 B 使用（或惰性 spawn）独立 resident 并受理 prompt
- **AND** MUST NOT 返回「另一 PI 会话的 turn 仍在进行中」
- **AND** A 的 run / 事件流 MUST 不受影响

#### Scenario: 同会话二次发送仍走 steer

- **WHEN** 同一 session id 上已有未 settle 的 run
- **THEN** 系统 MUST 在该 resident 上发送 `steer`（same-run 融合）
- **AND** MUST NOT 再 spawn 第二只进程

#### Scenario: 新会话不得复用上一场进程

- **WHEN** 发送未带有效 session id（新会话 / pending）
- **THEN** 系统 MUST spawn 新的 scratch resident，MUST NOT 回落到 workspace 级 tracked session id

#### Scenario: 树/统计/compact/fork 命令按会话取 resident

- **WHEN** 执行 `pi_get_session_tree` / `pi_get_session_stats` / `pi_compact` / `pi_fork` / `pi_get_fork_messages`
- **THEN** 命令 MUST 携带调用方 thread 的 session id 并使用该 session 的 resident
- **AND** MUST NOT 打开树/统计时 spawn 一只无 session 的共享进程给后续发送复用

#### Scenario: 活跃 run 禁止 fork/compact（仅挡本会话）

- **WHEN** 目标 session 存在未 settle 的 agent run 且调用 `pi_fork` / `pi_compact`
- **THEN** 系统 MUST 拒绝并返回「turn 仍在进行中」（fork 会切该进程的会话文件；pi `compact()` 内部第一步是 `abort()`）
- **AND** 其它 PI 会话的 resident MUST 不受影响
- **AND** 守卫 MUST 只读取该 session 的 run（对齐会先清掉本 resident 丢失 settle 的僵尸 run）

#### Scenario: RPC 禁用闩不得误伤存活 resident

- **WHEN** 某次 RPC spawn/handshake 失败已置 workspace 级 `rpc_disabled`，且另一 session 的 resident 仍存活
- **THEN** 后续发送 MUST 继续复用该存活 resident（RPC 主路径）
- **AND** 仅需要新 spawn 的会话才允许被禁用闩降级 print-json

### Requirement: RPC 不可用时回退 print-json

RPC spawn 或握手失败时系统 MUST log warn 并回退既有 `pi --print --mode json` spawn-per-turn 路径，用户发送 MUST NOT 因此失败。fallback 的忙互斥 MUST 只按同一 session 生效，且回退时 MUST 释放本次发送实际占用的 resident（含新会话 scratch 槽）。

#### Scenario: RPC 不可用时回退 print-json

- **WHEN** RPC spawn 或握手失败
- **THEN** 系统 MUST log warn 并回退既有 `pi --print --mode json` spawn-per-turn 路径
- **AND** 用户发送 MUST NOT 因此失败

#### Scenario: fallback 忙互斥仅按 session 生效

- **WHEN** 会话 A 已回退 print-json 且进程仍在运行，会话 B（或新会话）也需回退 print-json
- **THEN** B MUST 照常 spawn（不同 session / 新会话写不同 session JSONL）
- **AND** 仅当存在与本次发送同一 session id 的活跃 print-json 进程时，才允许报 busy 并让消息留在队列

#### Scenario: fallback 必须释放本次发送占用的 resident

- **WHEN** RPC 发送失败回退 print-json
- **THEN** 系统 MUST 按 `pi_resident_map_key(session_id, turn_id)` 释放本次发送占用的 resident（含 `scratch:{turn_id}` 新会话槽与非法 id 回落槽）
- **AND** `session_id` 缺失（新会话）时 MUST NOT 跳过释放

## ADDED Requirements

### Requirement: print-json 降级天花板 MUST 诚实表达

print-json 是 spawn-per-turn 降级路径：pi `--print` 模式在协议层没有 steering 通道。降级期间的 capability 表现 MUST 以诚实错误与可恢复语义表达，MUST NOT 静默假装成功或吞掉消息。

#### Scenario: 降级期同会话发送被拒且消息留队列

- **WHEN** RPC 不可用（latch 或 spawn 失败）且该 session 存在活跃 print-json 进程，用户再次发送
- **THEN** 系统 MUST 拒绝并返回说明降级与不可插话的错误（「rpc unavailable, print-json fallback cannot steer; the message stays queued」语义）
- **AND** 前端消息队列 MUST 保留该消息等待下轮投递，MUST NOT 丢弃

#### Scenario: 双证据 send gate 快速失败

- **WHEN** workspace 处于 rpc latch 冷却期 AND 同 session 的 print-json fallback 被占用
- **THEN** `engine_send_message` MUST 返回结构化错误 `pi_engine_unavailable`（不返回 started、不进 turn 状态机，避免孤儿 turn）
- **AND** 单证据（仅 latch 或仅 busy）MUST 照常放行（存活 resident 复用与 fallback 各自有自愈路径）

#### Scenario: RPC-only 命令降级保留 last-good

- **WHEN** RPC 不可用时调用 `pi_get_session_tree` / `pi_get_session_stats` / `pi_compact` / `pi_fork` / `pi_get_fork_messages`
- **THEN** 命令 MUST 返回可重试错误（树面板保留 last-good 快照 + 错误态与重试入口）
- **AND** MUST NOT 静默返回过期数据假装成功；这些命令 MUST NOT 回退 print-json（无等价 CLI 面）
