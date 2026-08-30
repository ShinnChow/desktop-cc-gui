## ADDED Requirements

### Requirement: PI Catalog Probe MUST Skip Extension Boot And Use Widened Budget

PI catalog 探测（RPC `get_available_models` 与 `--list-models` 回退链）MUST 以「跳过 extension boot」的参数执行，且探测预算 MUST 使用 PI 专属的放宽值（15s），避免扩展生态增长把 spawn 推过预算导致 fallback-only 降级。真实会话的 per-session RPC resident MUST NOT 受探测参数影响（用户扩展在会话内照常生效）。

#### Scenario: RPC probe skips extension boot

- **WHEN** backend 执行 PI catalog 探测的 RPC 路径
- **THEN** spawn args MUST 包含 `--no-session --no-extensions`
- **AND** 返回的模型数与 reasoning/thinkingLevelMap 元数据 MUST 与带扩展启动时一致

#### Scenario: list-models fallback retries without flag for old binaries

- **WHEN** RPC 探测失败回退 `pi --list-models`
- **THEN** 第一跳 MUST 带 `--no-extensions`；失败（非零退出 / 输出空 / 超时）后 MUST 再以无 flag 重试一次，兜底不识别该 flag 的旧版 pi
- **AND** 两跳都失败才落 generated fallback

#### Scenario: probe budget is PI-specific

- **WHEN** PI catalog 探测链计时
- **THEN** RPC 请求与 `--list-models` 两跳 MUST 共用 PI 专属预算（15s，宽于全局 DETECTION_TIMEOUT 的 10s）
- **AND** version 探测与其他引擎 MUST 维持全局 10s 不变

#### Scenario: real-session resident keeps extensions

- **WHEN** 用户发起 PI 会话（per-session RPC resident spawn）
- **THEN** resident MUST 以默认参数启动（不带 `--no-extensions`）
- **AND** 用户安装的 pi 扩展（工具型）MUST 在会话内照常生效

#### Scenario: probe contract is test-anchored

- **WHEN** CI 运行 `src-tauri/src/engine/status.rs` 相关单测
- **THEN** `pi_catalog_probe_rpc_args_skip_session_and_extension_boot` MUST 钉死探测 args 与 15s 预算，参数漂移即测试红
