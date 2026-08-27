## 1. Catalog 投影

- [x] `supported_thinking_levels_for_pi_model` 移植 pi 规则 + 单测
- [x] `parse_pi_available_models` 读 `get_available_models` data
- [x] `get_pi_models` 优先 ephemeral RPC（`--no-session`），失败回退 `--list-models`
- [x] `--list-models` `thinking=yes` 填标准五档；`no` 保持空
- [x] daemon `EngineFeatures::pi().reasoning_effort = true`

## 2. Composer

- [x] `ReasoningEffort` / `REASONING_LEVELS` / adapter normalize 补 `minimal`
- [x] `modelSelection.ts` PI 走 catalog allowlist
- [x] `ButtonArea` PI + 非空 options 显示选择器
- [x] i18n en/zh（及其他 locale）补 `reasoning.minimal`

## 3. 测试

- [x] Rust：map holes / non-reasoning / list-models yes/no
- [x] Vitest：modelSelection / ButtonArea / Adapter / ReasoningSelect
- [x] 不改切会话 catalog 路径
- [x] 发送闸门 `normalizeEngineScopedEffort` 放行 PI 七档（UI 选 Low 不再被丢成 null）
