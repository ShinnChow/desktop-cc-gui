# Design: add-pi-thinking-level-selector

## 决策

**Catalog 一次投影全量 allowlist，而不是点选时问 `get_available_thinking_levels`。**

`get_available_thinking_levels` 只描述 resident **当前模型**。Composer 里先切模型再发送时，resident 仍停在旧模型，点选查询会拿错允许集，除非提前 `set_model`（会写 session `model_change`，禁止）。

`get_available_models` 一次返回全部 Model（含 `reasoning` / `thinkingLevelMap`）。与现有 `pi --list-models` 一样只在 catalog 拉取时 spawn，成本同量级（都要加载 ModelRuntime），不进切会话热路径。

推导规则移植 pi `getSupportedThinkingLevels`：

- `reasoning !== true` → 空数组（UI 隐藏；不把 `["off"]` 当成可选项）
- `thinkingLevelMap[level] === null` → 该档隐藏
- `xhigh` / `max` 必须 map 里有非 undefined 才出现
- 其余标准档（`off/minimal/low/medium/high`）默认出现

## 回退

RPC 不可用（老 pi / handshake 失败）→ 现有 `--list-models` 表。`thinking=yes` 填 `off/minimal/low/medium/high`；`no` 为空。发送侧既有 `pick_thinking_level` 仍会夹紧。

## UI

PI 走 catalog 引擎分支（与 dsh/qoder 相同）：

- `isReasoningEffortSupportedForEngine("pi", options)` ↔ `options.length > 0`
- `getEffectiveReasoningSupported` / `getEffectiveSelectedEffort` 认 PI
- `ButtonArea` 在 `currentProvider === "pi" && reasoningOptions.length > 0` 渲染选择器
- 提供 Default（null）= 不下发 effort

## 不做什么

- 不在 `setActiveThreadId` / 模型点击上拉 catalog
- 不为每个模型 cycle `set_model`
- 不把 illegal 档回落成 medium；非法仍由发送侧 skip
