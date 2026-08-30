# provider-model-catalog-refresh Specification

## Purpose

定义 Provider-scoped 模型目录的配置重读、CLI discovery、分源合并和隔离契约。
## Requirements
### Requirement: Provider Catalog Actions MUST Separate Config Reload From CLI Discovery

系统 MUST 将 Provider 配置重读与 CLI model discovery 建模为两个独立动作，并按完整
`engine + providerProfileId` scope 更新模型目录。

#### Scenario: Reload config

- **WHEN** 用户对某个 Provider Profile 点击 `Reload Config`
- **THEN** 系统 MUST 重新读取该 binding 的 local/managed configuration
- **AND** MUST 只替换 configured catalog slice
- **AND** MUST NOT 发起 HTTP model request

#### Scenario: Discover models

- **WHEN** 用户对支持 model-list protocol 的 Provider Profile 点击 `Discover Models`
- **THEN** 系统 MUST 通过该 binding 对应的 CLI/runtime protocol 获取模型
- **AND** MUST 只替换 discovered catalog slice
- **AND** MUST NOT 发起 HTTP model request

#### Scenario: Unsupported CLI

- **WHEN** 目标 CLI 没有已验证的 model-list protocol
- **THEN** UI MUST 隐藏或禁用 `Discover Models`
- **AND** backend MUST NOT 解析 help text 或返回 fallback catalog 冒充 discovery

### Requirement: Provider Catalog Sources MUST Merge Without Losing User Intent

系统 MUST 合并 custom、configured、CLI-discovered、last-good 与 fallback 模型，并按
normalized runtime model identity 去重。

#### Scenario: Custom model overlaps discovery

- **WHEN** custom model 与 CLI-discovered model 指向同一 runtime model
- **THEN** custom/configured metadata MUST 获胜
- **AND** 最终模型框 MUST 只显示一个可执行选项

#### Scenario: Discovery refresh succeeds

- **WHEN** CLI discovery 返回新 catalog
- **THEN** 当前 binding 的 discovered slice MUST 被新结果替换
- **AND** custom/configured models MUST 保留

#### Scenario: Refresh fails

- **WHEN** config reload 或 CLI discovery 失败
- **THEN** 系统 MUST 保留 last-good catalog 与当前 selection
- **AND** MUST 在对应 binding 显示可诊断错误

### Requirement: Provider Catalog Requests MUST Be Binding-Isolated

Catalog cache、in-flight request、loading、error 与 stale-response guard MUST 使用完整
binding identity。

#### Scenario: Provider A resolves after Provider B

- **WHEN** Provider A 的刷新请求晚于 Provider B 返回
- **THEN** Provider A 结果 MUST 只更新 Provider A
- **AND** MUST NOT 覆盖 Provider B 当前可见模型框

#### Scenario: Duplicate action

- **WHEN** 同一 binding 的同一 action 仍在执行
- **THEN** 后续重复点击 MUST NOT 创建第二个并发请求

### Requirement: Local Provider Expansion MUST Read The Authoritative Configured Catalog

当用户在 Shared Session picker 中显式展开 local/disk Provider 时，系统 MUST 按完整
`engine + local provider sentinel` scope 重新读取 configured catalog。已完成的
module-level stale cache MUST NOT 覆盖本次结果；同 scope 的 concurrent request MUST
继续合并。

#### Scenario: stale Claude local cache is bypassed

- **WHEN** module cache 仍包含旧 Claude local catalog，用户从 Codex CLI 切换浏览到
  Claude Code 并展开 `Local Settings.json`
- **THEN** frontend MUST 请求 Claude local scope 的 forced refresh
- **AND** rendered rows MUST 来自当前 configured catalog
- **AND** backend persistence validation MUST 能验证同一 catalog/runtime identity pair

#### Scenario: concurrent local expansion is coalesced

- **WHEN** pointer、focus 或重复 activation 在首个 Claude local refresh 完成前触发相同
  scope 的加载
- **THEN** frontend MUST 复用同一个 in-flight request
- **AND** MUST NOT 创建第二个并发 IPC

#### Scenario: repeated activation after successful refresh reuses the result

- **WHEN** 同一 picker catalog owner 已成功完成 local authoritative refresh，随后
  pointer、focus 或 accordion activation 再次请求同一 scope
- **THEN** frontend MUST 直接复用本次 owner 已完成的 catalog
- **AND** MUST NOT 再次进入 loading 或创建第二次 forced refresh

#### Scenario: Native loading preserves last-good rows

- **WHEN** Native 单栏正在刷新 Provider catalog，且当前 binding 已有 last-good models
- **THEN** selector MUST 保持这些 rows 可见、可交互
- **AND** Shared local stale-row suppression MUST NOT 泄漏到 Native 模式

#### Scenario: managed provider retains normal cache behavior

- **WHEN** 用户展开 managed Provider Profile
- **THEN** frontend MUST 继续按 binding-scoped cache 加载 catalog
- **AND** local forced-refresh policy MUST NOT 使无关 managed catalog 失效

### Requirement: Provider Catalog Cache MUST Invalidate On Provider CRUD

供应商 add / update / delete / switch / settings-json-saved / cc-switch import 后，frontend 的 Provider Profile catalog 与 Provider-scoped model catalog 模块级缓存 MUST 失效，挂载中的 Atomic picker MUST 重置本地投影并重新拉取 provider list，未挂载实例 MUST 在下次挂载读取最新数据。

#### Scenario: New provider appears without restart

- **WHEN** 用户新增一个供应商并返回对话页
- **THEN** 模型选择器 MUST 无需重启即可展示该供应商渠道
- **AND** 渠道模型列表 MUST 按该供应商配置加载

#### Scenario: Deleted provider disappears

- **WHEN** 用户删除一个供应商
- **THEN** 选择器 MUST 不再展示该渠道
- **AND** 既有 Shared target 指向已删除渠道时 MUST 保持既有 error/loading 语义，不静默回退

### Requirement: Empty Managed Model Catalog MUST Fall Back To Configured Default Model

managed provider 的 model catalog 查询成功但返回空数组时，frontend MUST 读取该供应商配置中的默认模型并合成兜底 catalog row（Claude `ANTHROPIC_MODEL`/`ANTHROPIC_DEFAULT_*`，Kimi/Grok `model`，OpenCode `models[0]`）；Codex 由 backend `configToml.model` 已覆盖，frontend 不解析 TOML。兜底 row MUST 带 `providerProfileId` 与 `source: "provider-config"`，且 MUST NOT 写入模块级共享 cache（避免污染后续真实 catalog 重试）。

#### Scenario: Provider has a configured default model

- **WHEN** 某 managed 渠道 catalog 返回空数组
- **AND** 该供应商配置包含默认模型
- **THEN** 选择器 MUST 展示该默认模型为可选项
- **AND** 后续真实 catalog 加载成功后 MUST 以真实 catalog 覆盖兜底 row

#### Scenario: Provider has no configured default model

- **WHEN** catalog 空且供应商无默认模型
- **THEN** 选择器 MUST 展示自定义模型引导文案与「添加模型」入口

### Requirement: Empty Provider Model Catalog MUST Surface Custom Model Guidance

渠道模型列表为空且非 loading / 非 error 时，模型选择器子菜单 MUST 展示引导文案，指向「自定义模型」入口，帮助用户为新增供应商补充模型。

#### Scenario: Empty channel guidance

- **WHEN** 用户展开某渠道且模型列表为空
- **THEN** 子菜单 MUST 显示两行引导（标题 + 操作提示）
- **AND** 底部「添加模型」动作 MUST 保持可用

### Requirement: Qoder Catalog Requests MUST Be Distribution-Isolated And Cold-Path Only

Qoder model catalog cache, request dedupe and last-good state MUST include the
distribution profile id. The application MUST request Qoder catalog data only when
the picker is opened, the user explicitly refreshes, or a send cannot proceed
without a catalog. Session switching and sidebar selection MUST NOT initiate a Qoder
catalog IPC.

#### Scenario: rapid session switching causes no Qoder catalog fetch

- **WHEN** the user switches between Qoder Global/CN history rows in the sidebar
- **THEN** the application MUST update selection identity and chrome only
- **AND** it MUST NOT call `get_engine_models` or modify the active distribution

#### Scenario: stale Global response cannot overwrite CN

- **WHEN** a Global catalog request resolves after a newer CN catalog request
- **THEN** the CN-visible picker MUST retain CN rows
- **AND** Global rows MAY update only the Global cache scope

### Requirement: Fallback-Only Engine Catalog MUST Auto-Recover On Picker Open

Native 模型选择器打开时，若当前引擎可见 catalog 全部来自静态兜底（每行 `source === "fallback"` 且非空），系统 MUST 自动触发一次该引擎的 forced refresh，并复用手动刷新按钮的 spinner / error 语义（菜单保持打开）。每次菜单打开 MUST 最多触发一次自动刷新；in-flight 期间 MUST NOT 双发；失败后 MUST NOT 自动循环重试。catalog 已有真实模型或为空 catalog 引导态时 MUST NOT 触发。切会话路径 MUST NOT 因此新增任何 catalog IPC。Atomic / Shared picker 已有的打开预取行为 MUST 保持不变。

#### Scenario: fallback-only catalog auto-refreshes on open

- **WHEN** Native 模型选择器打开，且当前引擎组 models 全部 `source === "fallback"`
- **THEN** 系统 MUST 自动触发一次 forced refresh
- **AND** 菜单 MUST 保持打开并显示刷新 spinner
- **AND** 刷新成功后菜单内 MUST 直接呈现真实 catalog

#### Scenario: live catalog does not auto-refresh

- **WHEN** 选择器打开，且当前引擎组含任何非 fallback 来源的模型
- **THEN** 系统 MUST NOT 发起 catalog IPC

#### Scenario: refresh failure does not loop

- **WHEN** 自动刷新失败
- **THEN** 菜单 MUST 显示错误文案（复用刷新按钮 error 位）
- **AND** 系统 MUST NOT 自动重试，直到下次菜单打开再触发一次

#### Scenario: session switch stays catalog-free

- **WHEN** 用户在侧栏连续切换会话（含 PI 会话）
- **THEN** 系统 MUST NOT 发起任何 catalog IPC
- **AND** 自动恢复逻辑 MUST 只由模型选择器打开事件驱动

### Requirement: On-Demand Catalog Timeout MUST Cover Backend Probe Chain

on-demand catalog 请求的 orchestrator timeout MUST 覆盖目标引擎后端最坏探测链（含回退路径）；idle-prewarm MAY 使用更短 timeout。PI 引擎后端 version 探测与 models 探测 MUST 并行执行，使最坏串行链不超过单次探测 timeout 与 models 回退链之和。

#### Scenario: on-demand refresh survives slow CLI cold start

- **WHEN** PI CLI 冷启动导致 RPC 探测接近超时并回退 `--list-models`
- **THEN** FE on-demand 请求 MUST NOT 在后端最坏路径（~20s）内被 8s 超时截断
- **AND** 超时兜底 MUST 仅在超过覆盖阈值后触发

#### Scenario: pi detection probes run concurrently

- **WHEN** backend 执行 `detect_pi_status`
- **THEN** version 探测与 models 探测 MUST 并行发起
- **AND** 未安装时 models 探测结果 MUST 被丢弃，返回 not-installed 状态

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

