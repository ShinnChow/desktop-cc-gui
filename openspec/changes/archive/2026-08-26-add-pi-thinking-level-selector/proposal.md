# Change: add-pi-thinking-level-selector

## Why

PI 的思考强度是一等公民（`off/minimal/low/medium/high/xhigh/max`，按模型 `thinkingLevelMap` 裁剪）。mossx 发送链路已经能 `set_thinking_level` / `--thinking`，但 Composer 选择器对 PI 静默隐藏，catalog 也不填 `supportedReasoningEfforts`。用户无法按模型选档。

## What Changes

- Catalog（`get_engine_models` / `detect_pi_status`）为每个 PI 模型投影 `supportedReasoningEfforts`
  - 优先短驻 `pi --mode rpc --no-session` + `get_available_models`，按 pi `getSupportedThinkingLevels` 规则从 `reasoning` + `thinkingLevelMap` 推导
  - RPC 失败回退 `pi --list-models`：`thinking=yes` 给标准五档 `off/minimal/low/medium/high`（`xhigh/max` 仍 opt-in）
- Composer 按模型 allowlist 显示 `ReasoningSelect`（对齐 dsh/qoder，不走 Claude 固定列表）
- 补 `minimal` 到 `ReasoningEffort` / `REASONING_LEVELS` / i18n
- daemon `EngineFeatures::pi().reasoning_effort` 与主 crate 对齐为 `true`
- **禁止**切会话 / 点击模型去调 `get_available_thinking_levels` 或 `get_engine_models`

## Impact

| 维度 | 说明 |
| ---- | ---- |
| Backend | `status.rs` catalog 解析；`pi_rpc.rs` `get_available_models`；daemon features |
| Frontend | `modelSelection.ts`、`ButtonArea`、`ChatInputBoxAdapter`、`types.ts`、i18n |
| 热路径 | 不改切会话；catalog 仍只在打开 picker / 手动刷新 / 发送前缺目录时拉取 |
| Out of scope | 点击模型时 `set_model`；resident 档位 overlay；改 pi CLI |

## Acceptance

1. 选中 PI + 支持思考的模型 → composer 出现思考强度，菜单只含该模型允许集。
2. 不支持思考的模型 → 选择器隐藏，send 不带 `effort`。
3. 用户选 `high` 发送 → `SendMessageParams.effort=high`，resident `set_thinking_level("high")`（仍受既有 allowlist 夹紧）。
4. Default / 空档 → 不下发，pi 用自身 default。
5. 连点 PI 历史会话不触发新的 catalog IPC。
