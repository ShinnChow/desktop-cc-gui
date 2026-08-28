# Delta: provider-model-catalog-refresh

## MODIFIED Requirements

### Requirement: On-Demand Catalog Timeout MUST Cover Backend Probe Chain

on-demand catalog 请求的 orchestrator timeout MUST 覆盖目标引擎后端最坏探测链（含回退路径）；idle-prewarm MAY 使用更短 timeout。自 `refactor-engine-detection-pipeline` 起，引擎检测（`detect_engines`）已与模型目录探测解耦（metadata-only），本 requirement 的覆盖对象为 `get_engine_models` 路径的 catalog 探测链。PI 引擎 catalog 探测链（RPC 探测与 `--list-models` 回退）MUST 保持既有预算与回退语义（见「PI Catalog Probe MUST Skip Extension Boot And Use Widened Budget」）；引擎检测 MUST NOT 承担目录探测，MUST NOT 因此缩短或绕过本覆盖要求。

#### Scenario: on-demand refresh survives slow CLI cold start

- **WHEN** PI CLI 冷启动导致 catalog RPC 探测接近超时并回退 `--list-models`
- **THEN** FE on-demand 请求 MUST NOT 在后端最坏路径（~20s）内被 8s 超时截断
- **AND** 超时兜底 MUST 仅在超过覆盖阈值后触发

#### Scenario: catalog probe chain remains the only model-listing path

- **WHEN** backend 执行 PI 引擎的检测（`detect_engines` 路径）
- **THEN** 检测 MUST NOT 运行 RPC models 探测或 `--list-models` 回退链
- **AND** 该链 MUST 仅在 `get_engine_models`（on-demand / 打开选择器 / 显式刷新 / 发送前缺目录）路径执行
- **AND** 其并行/回退预算 MUST 保持本 capability 既有 requirement 不变
