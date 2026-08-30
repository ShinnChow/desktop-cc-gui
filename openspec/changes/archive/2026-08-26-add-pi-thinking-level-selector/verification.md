# verification · add-pi-thinking-level-selector

> 2026-08-27 收口补充（L1 归档批次）。13/13 task 已完成。

## Evidence

- 实现事实源：`src-tauri/src/engine/pi.rs`（`pick_thinking_level` + resident `get_available_thinking_levels` 白名单 + `set_thinking_level`）与 print 路径 `--thinking`（`build_command`）；档位语义移植上游 `getSupportedThinkingLevels`（`src-tauri/src/engine/status.rs` `supported_thinking_levels_for_pi_model`）。
- 前端：composer 档位选择器消费 catalog `supportedReasoningEfforts`；相关测试 `Composer.shared-pi-reasoning.test.tsx` / `atomicModelReasoning.test.ts` / `ModelSelect.test.tsx` 覆盖 PI 档位联动。
- 单测：pi.rs 41 测（含 thinking 相关）、status.rs provenance 测试。
- ADR 校准行已存在（基石设计「最近校准」2026-08-25 提及本 change）；不命中更新触发器，无需新增。

## Waiver

- 无。
