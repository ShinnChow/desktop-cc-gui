# Delta: dsh-session-history

## ADDED Requirements

### Requirement: DSH Host Unavailability MUST Fast-Fail Session Open

dsh 宿主不可达时，会话打开路径 MUST 快速失败并降级为可读回退，MUST NOT 每次点击都重新发起注定失败的宿主 RPC：

- HTTP client SHALL 配置 `connect_timeout`（≤800ms），传输层总超时（describe 3s / RPC 30s）语义不变。
- 传输层 SHALL 具备熔断器：连续 ≥2 次 transport error 后进入 open（60s 冷却），open 期内宿主 RPC MUST NOT 发起 HTTP 请求、直接返回结构化 Down（`reason: "breaker-open"`）；冷却到期 SHALL 放行一次半开探测，成功 close、失败重开。
- 前端 history loader SHALL 把结构化 Down 视为不可重试，直接走 V0/本地快照可读回退（`reopenOutcome:"recovered"` 链路），MUST NOT 刷 `thread/history loader error`；宿主离线状态 SHALL 反映到既有 `dshHostStatus` 视图（`kind:"down"`）。
- 本条 MUST NOT 改变 dsh supervisor 拉起策略与切会话 catalog 红线（`session-switch-catalog-fetch-pitfall`）。

#### Scenario: 宿主离线时打开会话亚秒回退

- **WHEN** dsh daemon 未运行且用户点开一个 dsh/shared 会话
- **THEN** 熔断 open 期内打开路径不发 HTTP，可读回退在 <50ms 内出现
- **AND** error-log 无 `thread/history loader error` 刷屏

#### Scenario: 熔断自愈

- **WHEN** daemon 恢复且冷却到期
- **THEN** 半开探测成功后熔断 close，后续打开走正常宿主 RPC
- **AND** 探测失败则重新 open 60s
