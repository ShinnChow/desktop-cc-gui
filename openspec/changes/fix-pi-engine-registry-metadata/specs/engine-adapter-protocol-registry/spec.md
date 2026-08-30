## ADDED Requirements

### Requirement: Built-in Protocol Metadata MUST Reflect The Actual Primary Transport

Built-in engine 的 `protocol_family` / `execution_model` 注册元数据 MUST 反映该引擎的**主传输路径**（primary transport），MUST NOT 以降级路径（fallback）或历史遗留命名登记。RPC 长驻型引擎 MUST 以专属 protocol family + `persistent` 登记；spawn-per-turn JSON 流引擎以 `stream-json-cli` + `one-shot` 登记。

#### Scenario: pi registers as an rpc resident

- **WHEN** 读取 registry 中 `pi` 的 entry
- **THEN** `protocolFamily` MUST 为 `pi-rpc` 且 `executionModel` MUST 为 `persistent`
- **AND** 该口径 MUST 与 capability matrix 的 `rpc.server = supported` 一致

#### Scenario: fallback path does not change registered metadata

- **WHEN** pi RPC 不可用并降级 `pi --print --mode json`（spawn-per-turn）
- **THEN** registry 登记的主传输元数据 MUST 保持 `pi-rpc` / `persistent` 不变
- **AND** 降级状态 MUST 由运行时健康状态（如 rpc latch）表达，而非改写 registry

#### Scenario: three-side parity holds for the new family

- **WHEN** 治理脚本校验 `engineIds.json`、Rust enum、daemon 共享模块
- **THEN** `pi-rpc` MUST 三侧一致（kebab-case 序列化），id 序与字段完整性检查 MUST 通过
